import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  active,
  and,
  eq,
  gt,
  invitations,
  isNull,
  memberships,
  organizations,
  sql,
  users,
  type DatabaseClient,
} from '@cognitive-dag/db';
import {
  resolveCorrelationId,
  type Invitation,
  type InvitationPreview,
  type OrganizationSummary,
  type Role,
} from '@cognitive-dag/contracts';
import { generateToken, hashToken, hashTokenHex } from '../auth/one-time-token';
import { isUniqueViolation } from '../auth/pg-errors';
import {
  AlreadyMemberException,
  InvitationForAnotherAccountException,
  ResourceNotFoundException,
  TokenInvalidException,
} from '../common/errors/domain.exception';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';
import { MailService } from '../mail/mail.service';
import { invitationEmail, invitationLink } from '../mail/templates';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import type { MemberActor } from './members.service';

/** FR-023: an invitation lives 7 days. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InvitationRow = typeof invitations.$inferSelect;

const toInvitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  email: row.email,
  role: row.role,
  expiresAt: row.expiresAt.toISOString(),
});

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly events: SecurityEventLogger,
    private readonly cls: ClsService,
  ) {}

  /** Pending invitations that have not expired, newest first. */
  list(userId: string, organizationId: string): Promise<Invitation[]> {
    return this.database.withContext({ userId, organizationId }, async (tx) => {
      const rows = await tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, sql`now()`),
          ),
        );
      return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toInvitation);
    });
  }

  /**
   * Invites an email with a role. A pending invitation to the same email is replaced, so only the
   * newest link works; a current member is refused (FR-023, edge case "already a member").
   */
  async create(actor: MemberActor, email: string, role: Role): Promise<Invitation> {
    await this.rateLimit.consume(RATE_RULES.inviteOrganization, actor.organizationId);

    const token = generateToken();
    const created = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId, lookupEmail: email },
      async (tx) => {
        const [existing] = await active.users(tx, eq(users.email, email));
        if (existing) {
          const [membership] = await active.memberships(
            tx,
            and(
              eq(memberships.organizationId, actor.organizationId),
              eq(memberships.userId, existing.id),
            ),
          );
          if (membership) throw new AlreadyMemberException();
        }
        const [organization] = await active.organizations(
          tx,
          eq(organizations.id, actor.organizationId),
        );
        const [inviter] = await active.users(tx, eq(users.id, actor.userId));
        if (!organization || !inviter) throw new ResourceNotFoundException();

        await tx
          .update(invitations)
          .set({ status: 'revoked', revokedAt: sql`now()` })
          .where(
            and(
              eq(invitations.organizationId, actor.organizationId),
              eq(invitations.email, email),
              eq(invitations.status, 'pending'),
            ),
          );
        const [row] = await tx
          .insert(invitations)
          .values({
            organizationId: actor.organizationId,
            email,
            role,
            tokenHash: hashToken(token),
            invitedBy: actor.userId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          })
          .returning();
        return { row: row!, organizationName: organization.name, inviterName: inviter.name };
      },
    );

    this.mail.dispatch({
      to: email,
      correlationId: resolveCorrelationId(this.cls.getId()),
      ...invitationEmail({
        organizationName: created.organizationName,
        inviterName: created.inviterName,
        role,
        url: invitationLink(this.config.APP_BASE_URL ?? this.config.WEB_ORIGIN, token),
      }),
    });
    this.events.emit({
      event: 'invitation.sent',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return toInvitation(created.row);
  }

  async revoke(actor: MemberActor, invitationId: string): Promise<void> {
    const revoked = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      (tx) =>
        tx
          .update(invitations)
          .set({ status: 'revoked', revokedAt: sql`now()` })
          .where(
            and(
              eq(invitations.id, invitationId),
              eq(invitations.organizationId, actor.organizationId),
              eq(invitations.status, 'pending'),
            ),
          )
          .returning({ id: invitations.id }),
    );
    if (revoked.length === 0) throw new ResourceNotFoundException();
    this.events.emit({
      event: 'invitation.revoked',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
  }

  /**
   * What the invited person sees before signing in. The token is the only credential: it
   * unlocks this invitation's organization name and nothing else (data-model.md, option B).
   * Unknown, expired, revoked and accepted links are the same 422.
   */
  async preview(token: string, ip: string): Promise<InvitationPreview> {
    await this.rateLimit.consume(RATE_RULES.previewInvitationIp, ip);
    return this.database.withContext({ lookupTokenHash: hashTokenHex(token) }, async (tx) => {
      const [invitation] = await tx.select().from(invitations).where(this.usable(token));
      if (!invitation) throw new TokenInvalidException();
      const [organization] = await active.organizationNames(
        tx,
        eq(organizations.id, invitation.organizationId),
      );
      if (!organization) throw new TokenInvalidException();
      return {
        organizationName: organization.name,
        email: invitation.email,
        role: invitation.role,
      };
    });
  }

  /**
   * The signed-in person joins with the invited role. The invitation is bound to its email: any
   * other account gets 403 and the link stays valid for the right one. The conditional update makes
   * it single use even under concurrent requests.
   */
  async accept(userId: string, token: string, ip: string): Promise<OrganizationSummary> {
    const joined = await this.database.withContext(
      { userId, lookupTokenHash: hashTokenHex(token) },
      async (tx, extend) => {
        const [invitation] = await tx.select().from(invitations).where(this.usable(token));
        if (!invitation) throw new TokenInvalidException();

        const [user] = await active.users(tx, eq(users.id, userId));
        if (!user || user.email !== invitation.email) {
          throw new InvitationForAnotherAccountException();
        }

        await extend({ organizationId: invitation.organizationId });
        const [current] = await active.memberships(
          tx,
          and(
            eq(memberships.organizationId, invitation.organizationId),
            eq(memberships.userId, userId),
          ),
        );
        if (current) throw new AlreadyMemberException();

        const claimed = await tx
          .update(invitations)
          .set({ status: 'accepted', acceptedBy: userId, acceptedAt: sql`now()` })
          .where(and(eq(invitations.id, invitation.id), eq(invitations.status, 'pending')))
          .returning({ id: invitations.id });
        if (claimed.length === 0) throw new TokenInvalidException();

        try {
          await tx.insert(memberships).values({
            organizationId: invitation.organizationId,
            userId,
            role: invitation.role,
          });
        } catch (error) {
          if (isUniqueViolation(error, 'memberships_organization_user_active_key')) {
            throw new AlreadyMemberException();
          }
          throw error;
        }
        const [organization] = await active.organizations(
          tx,
          eq(organizations.id, invitation.organizationId),
        );
        if (!organization) throw new TokenInvalidException();
        return {
          summary: {
            id: organization.id,
            name: organization.name,
            role: invitation.role,
            isPersonal: organization.isPersonal,
          } satisfies OrganizationSummary,
          organizationId: organization.id,
        };
      },
    );
    this.events.emit({
      event: 'invitation.accepted',
      outcome: 'success',
      userId,
      organizationId: joined.organizationId,
      ip,
    });
    return joined.summary;
  }

  /** The invitation behind a token, if it is still pending and inside its 7 days. */
  private usable(token: string) {
    return and(
      eq(invitations.tokenHash, hashToken(token)),
      eq(invitations.status, 'pending'),
      gt(invitations.expiresAt, sql`now()`),
      isNull(invitations.revokedAt),
    );
  }
}

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  active,
  and,
  eq,
  gt,
  isNull,
  memberships,
  newId,
  oneTimeTokens,
  organizations,
  sql,
  users,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { resolveCorrelationId, type RegisterRequest } from '@cognitive-dag/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';
import { DomainException, TokenInvalidException } from '../common/errors/domain.exception';
import { MailService } from '../mail/mail.service';
import { registrationAttemptEmail, verificationEmail, verificationLink } from '../mail/templates';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { hashTokenHex } from './one-time-token';
import { EMAIL_VERIFICATION_TTL_MS, OneTimeTokenService } from './one-time-token.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { isUniqueViolation } from './pg-errors';

/** Identical for every outcome of register, resend and (later) reset requests (FR-014). */
export const ACCEPTED_MESSAGE = 'Si los datos son correctos, recibirás un correo en breve.';

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly tokens: OneTimeTokenService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly events: SecurityEventLogger,
    private readonly cls: ClsService,
  ) {}

  /**
   * Creates user, personal organization and owner membership in one transaction (FR-001). An
   * existing email gets the same answer and a notice email instead (FR-014).
   */
  async register(request: RegisterRequest, ip: string): Promise<void> {
    await this.rateLimit.consume(RATE_RULES.registerIp, ip);
    await this.rateLimit.consume(RATE_RULES.registerEmail, sha256Hex(request.email));

    const problems = this.policy.check(request.password);
    if (problems.length > 0) {
      throw new DomainException(
        422,
        'VALIDATION_FAILED',
        'La solicitud contiene datos inválidos.',
        {
          errors: problems.map((message) => ({ field: 'password', message })),
        },
      );
    }

    // Hashed before looking at the database, so new and existing emails cost the same time (R12).
    const passwordHash = await this.hasher.hash(request.password);

    try {
      const token = await this.database.withContext({}, async (tx, extend) => {
        // INSERT ... RETURNING would need to read rows the policies do not yet show, so the ids
        // are generated first and placed in the context (data-model.md, RLS notes).
        const userId = await newId(tx);
        const organizationId = await newId(tx);
        await extend({ userId, organizationId });
        await tx.insert(users).values({
          id: userId,
          email: request.email,
          name: request.name,
          passwordHash,
        });
        await tx.insert(organizations).values({
          id: organizationId,
          name: request.organizationName ?? `Organización de ${request.name}`.slice(0, 100),
          isPersonal: true,
          createdBy: userId,
        });
        await tx.insert(memberships).values({ organizationId, userId, role: 'owner' });
        const issued = await this.tokens.issue(
          tx,
          userId,
          'email_verification',
          EMAIL_VERIFICATION_TTL_MS,
        );
        this.events.emit({ event: 'user.registered', outcome: 'success', userId, ip });
        return issued;
      });
      this.sendVerification(request.email, request.name, token);
    } catch (error) {
      if (!isUniqueViolation(error, 'users_email_active_key')) throw error;
      await this.noticeExistingAccount(request.email, ip);
    }
  }

  /** Consumes a verification token and marks the email as verified (FR-005). */
  async verifyEmail(token: string, ip: string): Promise<void> {
    const userId = await this.database.withContext(
      { lookupTokenHash: hashTokenHex(token) },
      async (tx, extend) => {
        const [row] = await tx
          .select()
          .from(oneTimeTokens)
          .where(
            and(
              eq(oneTimeTokens.tokenHash, Buffer.from(hashTokenHex(token), 'hex')),
              eq(oneTimeTokens.purpose, 'email_verification'),
              isNull(oneTimeTokens.consumedAt),
              gt(oneTimeTokens.expiresAt, sql`now()`),
            ),
          );
        if (!row) throw new TokenInvalidException();
        await extend({ userId: row.userId });
        // The conditional update makes a token usable once even under concurrent requests.
        const consumed = await tx
          .update(oneTimeTokens)
          .set({ consumedAt: sql`now()` })
          .where(and(eq(oneTimeTokens.id, row.id), isNull(oneTimeTokens.consumedAt)))
          .returning({ id: oneTimeTokens.id });
        if (consumed.length === 0) throw new TokenInvalidException();
        await tx
          .update(users)
          .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
          .where(and(eq(users.id, row.userId), isNull(users.deletedAt)));
        return row.userId;
      },
    );
    this.events.emit({ event: 'user.email_verified', outcome: 'success', userId, ip });
  }

  /** Sends a fresh link to an unverified account; the answer never says whether one existed. */
  async resendVerification(email: string, ip: string): Promise<void> {
    await this.rateLimit.consume(RATE_RULES.resendIp, ip);
    await this.rateLimit.consume(RATE_RULES.resendEmail, sha256Hex(email));

    const issued = await this.database.withContext({ lookupEmail: email }, async (tx, extend) => {
      const [user] = await active.users(tx);
      if (!user || user.emailVerifiedAt !== null) return undefined;
      await extend({ userId: user.id });
      const token = await this.tokens.issue(
        tx,
        user.id,
        'email_verification',
        EMAIL_VERIFICATION_TTL_MS,
      );
      return { token, name: user.name };
    });
    if (issued) this.sendVerification(email, issued.name, issued.token);
  }

  private sendVerification(email: string, name: string, token: string): void {
    const url = verificationLink(this.config.APP_BASE_URL ?? this.config.WEB_ORIGIN, token);
    this.mail.dispatch({
      to: email,
      correlationId: resolveCorrelationId(this.cls.getId()),
      ...verificationEmail(name, url),
    });
  }

  private async noticeExistingAccount(email: string, ip: string): Promise<void> {
    const owner = await this.database.withContext({ lookupEmail: email }, async (tx) => {
      const [user] = await active.users(tx);
      return user;
    });
    this.events.emit({ event: 'user.registered', outcome: 'failure', userId: owner?.id, ip });
    if (!owner) return;
    this.mail.dispatch({
      to: email,
      correlationId: resolveCorrelationId(this.cls.getId()),
      ...registrationAttemptEmail(owner.name),
    });
  }
}

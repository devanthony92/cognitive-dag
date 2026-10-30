import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  eq,
  inArray,
  isNull,
  memberships,
  sql,
  users,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import type { Member, Role } from '@cognitive-dag/contracts';
import { isCheckViolation, isDeadlock } from '../auth/pg-errors';
import { LastOwnerException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { wouldLeaveNoOwner } from './member-rules';

/** Who acts, on which organization, from where. Only the owner role reaches the writers. */
export interface MemberActor {
  userId: string;
  organizationId: string;
  ip: string;
}

const ROLE_ORDER: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 };

@Injectable()
export class MembersService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly events: SecurityEventLogger,
  ) {}

  /** Active members, owners first. Visible to every role of the organization. */
  list(userId: string, organizationId: string): Promise<Member[]> {
    return this.database.withContext({ userId, organizationId }, async (tx) => {
      const rows = await active.memberships(tx, eq(memberships.organizationId, organizationId));
      if (rows.length === 0) return [];
      const people = await active.users(
        tx,
        inArray(
          users.id,
          rows.map((row) => row.userId),
        ),
      );
      const byId = new Map(people.map((person) => [person.id, person]));
      return rows
        .flatMap((row) => {
          const person = byId.get(row.userId);
          return person
            ? [
                {
                  membershipId: row.id,
                  userId: row.userId,
                  name: person.name,
                  email: person.email,
                  role: row.role,
                },
              ]
            : [];
        })
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
    });
  }

  async changeRole(actor: MemberActor, membershipId: string, role: Role): Promise<Member> {
    const member = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const { target, all } = await this.load(tx, actor.organizationId, membershipId);
        if (wouldLeaveNoOwner(all, membershipId, { role })) throw new LastOwnerException();
        if (target.role !== role) {
          await this.guardOwnerTrigger(
            tx
              .update(memberships)
              .set({ role })
              .where(this.activeMembership(actor.organizationId, membershipId)),
          );
        }
        const [person] = await active.users(tx, eq(users.id, target.userId));
        return {
          membershipId,
          userId: target.userId,
          name: person?.name ?? '',
          email: person?.email ?? '',
          role,
        };
      },
    );
    this.events.emit({
      event: 'membership.role_changed',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return member;
  }

  /** Soft delete: the row stays with `deleted_at`; coming back means a new membership. */
  async remove(actor: MemberActor, membershipId: string): Promise<void> {
    await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const { all } = await this.load(tx, actor.organizationId, membershipId);
        if (wouldLeaveNoOwner(all, membershipId, { remove: true })) throw new LastOwnerException();
        await this.guardOwnerTrigger(
          tx
            .update(memberships)
            .set({ deletedAt: sql`now()` })
            .where(this.activeMembership(actor.organizationId, membershipId)),
        );
      },
    );
    this.events.emit({
      event: 'membership.removed',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
  }

  private activeMembership(organizationId: string, membershipId: string) {
    return and(
      eq(memberships.id, membershipId),
      eq(memberships.organizationId, organizationId),
      isNull(memberships.deletedAt),
    );
  }

  /** The membership of the path, looked up inside the organization: any other id is a 404. */
  private async load(tx: Tx, organizationId: string, membershipId: string) {
    const all = await active.memberships(tx, eq(memberships.organizationId, organizationId));
    const target = all.find((row) => row.id === membershipId);
    if (!target) throw new ResourceNotFoundException();
    return {
      target,
      all: all.map((row) => ({ membershipId: row.id, role: row.role })),
    };
  }

  /**
   * Two owners stepping down at once both pass the check above; the `memberships_keep_owner`
   * trigger stops the second (or deadlocks with it). Either way the answer is the same 409.
   */
  private async guardOwnerTrigger(write: PromiseLike<unknown>): Promise<void> {
    try {
      await write;
    } catch (error) {
      if (isCheckViolation(error, 'memberships_keep_owner') || isDeadlock(error)) {
        throw new LastOwnerException();
      }
      throw error;
    }
  }
}

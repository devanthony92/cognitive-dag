import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  eq,
  isNull,
  inArray,
  memberships,
  newId,
  organizations,
  type DatabaseClient,
} from '@cognitive-dag/db';
import type { OrganizationSummary } from '@cognitive-dag/contracts';
import { ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly events: SecurityEventLogger,
  ) {}

  /** Organizations where the user has an active membership: the personal one first, then by name. */
  listFor(userId: string): Promise<OrganizationSummary[]> {
    return this.database.withContext({ userId }, async (tx) => {
      const owned = await active.memberships(tx, eq(memberships.userId, userId));
      if (owned.length === 0) return [];
      const roles = new Map(
        owned.map((membership) => [membership.organizationId, membership.role]),
      );
      const rows = await active.organizations(tx, inArray(organizations.id, [...roles.keys()]));
      return rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          role: roles.get(row.id)!,
          isPersonal: row.isPersonal,
        }))
        .sort(
          (a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.name.localeCompare(b.name),
        );
    });
  }

  /** Renames the active organization; the policy `organizations_update` is the second layer. */
  async rename(
    actor: { userId: string; organizationId: string; ip: string },
    name: string,
  ): Promise<OrganizationSummary> {
    const row = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const [updated] = await tx
          .update(organizations)
          .set({ name })
          .where(and(eq(organizations.id, actor.organizationId), isNull(organizations.deletedAt)))
          .returning();
        if (!updated) throw new ResourceNotFoundException();
        return updated;
      },
    );
    this.events.emit({
      event: 'org.renamed',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return { id: row.id, name: row.name, role: 'owner', isPersonal: row.isPersonal };
  }

  /** Creates an organization and makes its creator the owner, in one transaction (FR-016). */
  async create(userId: string, name: string, ip: string): Promise<OrganizationSummary> {
    const id = await this.database.withContext({ userId }, async (tx, extend) => {
      // The ids are generated first so the context can name the row before it exists (R8).
      const organizationId = await newId(tx);
      await extend({ organizationId });
      await tx
        .insert(organizations)
        .values({ id: organizationId, name, isPersonal: false, createdBy: userId });
      await tx.insert(memberships).values({ organizationId, userId, role: 'owner' });
      return organizationId;
    });
    this.events.emit({ event: 'org.created', outcome: 'success', userId, organizationId: id, ip });
    return { id, name, role: 'owner', isPersonal: false };
  }
}

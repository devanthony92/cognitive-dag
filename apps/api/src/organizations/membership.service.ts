import { Inject, Injectable } from '@nestjs/common';
import { active, and, eq, memberships, type DatabaseClient } from '@cognitive-dag/db';
import type { Role } from '@cognitive-dag/contracts';
import { DATABASE } from '../database/database.module';

export interface ActiveMembership {
  membershipId: string;
  role: Role;
}

@Injectable()
export class MembershipService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseClient) {}

  /** The user's active membership in the organization, read on every request (FR-025). */
  async find(userId: string, organizationId: string): Promise<ActiveMembership | undefined> {
    return this.database.withContext({ userId, organizationId }, async (tx) => {
      const [row] = await active.memberships(
        tx,
        and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)),
      );
      return row ? { membershipId: row.id, role: row.role } : undefined;
    });
  }
}

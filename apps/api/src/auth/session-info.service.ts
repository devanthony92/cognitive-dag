import { Inject, Injectable } from '@nestjs/common';
import { active, eq, users, type DatabaseClient } from '@cognitive-dag/db';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { UnauthenticatedException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { OrganizationsService } from '../organizations/organizations.service';

/** The answer of login and `GET /auth/session`: who is signed in, where, and the CSRF token. */
@Injectable()
export class SessionInfoService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly organizations: OrganizationsService,
  ) {}

  async build(userId: string, csrfToken: string): Promise<SessionInfo> {
    const [user] = await this.database.withContext({ userId }, (tx) =>
      active.users(tx, eq(users.id, userId)),
    );
    if (!user) throw new UnauthenticatedException();
    return {
      user: { id: user.id, name: user.name, email: user.email },
      organizations: await this.organizations.listFor(userId),
      csrfToken,
    };
  }
}

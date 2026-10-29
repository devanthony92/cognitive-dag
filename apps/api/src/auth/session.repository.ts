import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  eq,
  gt,
  isNull,
  sessions,
  sql,
  users,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { DATABASE } from '../database/database.module';

export type SessionRevokeReason = 'logout' | 'password_change' | 'password_reset' | 'idle_timeout';

export interface NewSession {
  userId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer;
  ip: string;
  userAgent: string | null;
  expiresAt: Date;
}

export interface ActiveSession {
  id: string;
  userId: string;
  csrfTokenHash: Buffer;
}

/** PostgreSQL side of a session: the source of truth for revocation and the 12 h limit (R5). */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE) private readonly database: DatabaseClient) {}

  async insert(session: NewSession): Promise<void> {
    await this.database.withContext({ userId: session.userId }, (tx) =>
      tx.insert(sessions).values({
        userId: session.userId,
        tokenHash: session.tokenHash,
        csrfTokenHash: session.csrfTokenHash,
        ip: session.ip,
        userAgent: session.userAgent,
        expiresAt: session.expiresAt,
      }),
    );
  }

  /** The session if it is neither revoked nor past its absolute limit and its user still exists. */
  async findActive(tokenHash: Buffer): Promise<ActiveSession | undefined> {
    return this.database.withContext(
      { lookupTokenHash: tokenHash.toString('hex') },
      async (tx, extend) => {
        const [row] = await tx
          .select({
            id: sessions.id,
            userId: sessions.userId,
            csrfTokenHash: sessions.csrfTokenHash,
          })
          .from(sessions)
          .where(
            and(
              eq(sessions.tokenHash, tokenHash),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, sql`now()`),
            ),
          );
        if (!row) return undefined;
        await extend({ userId: row.userId });
        const [user] = await active.users(tx, eq(users.id, row.userId));
        return user ? row : undefined;
      },
    );
  }

  /** Idempotent: an already revoked session keeps its first reason. */
  async revoke(tokenHash: Buffer, reason: SessionRevokeReason): Promise<void> {
    await this.database.withContext({ lookupTokenHash: tokenHash.toString('hex') }, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: sql`now()`, revokeReason: reason })
        .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt))),
    );
  }
}

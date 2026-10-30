import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  active,
  and,
  eq,
  gt,
  isNull,
  oneTimeTokens,
  sql,
  users,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { resolveCorrelationId } from '@cognitive-dag/contracts';
import { DATABASE } from '../database/database.module';
import {
  DomainException,
  InvalidCredentialsException,
  TokenInvalidException,
} from '../common/errors/domain.exception';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail, passwordResetLink } from '../mail/templates';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { hashToken, hashTokenHex } from './one-time-token';
import { OneTimeTokenService, PASSWORD_RESET_TTL_MS } from './one-time-token.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { SessionRepository } from './session.repository';
import { SessionService, type AuthSession } from './session.service';

const CHANGE_LIMIT = 'password-change:user';

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PasswordService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly tokens: OneTimeTokenService,
    private readonly sessionRepository: SessionRepository,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly events: SecurityEventLogger,
    private readonly cls: ClsService,
  ) {}

  /**
   * Mails a reset link to a verified account. The answer is the same whether the account exists or
   * not (FR-014); the only difference is a token insert and a mail queued after the commit.
   */
  async requestReset(email: string, ip: string): Promise<void> {
    await this.rateLimit.consume(RATE_RULES.resetIp, ip);
    await this.rateLimit.consume(RATE_RULES.resetEmail, sha256Hex(email));

    const issued = await this.database.withContext({ lookupEmail: email }, async (tx, extend) => {
      const [user] = await active.users(tx);
      if (!user || user.emailVerifiedAt === null) return undefined;
      await extend({ userId: user.id });
      const token = await this.tokens.issue(tx, user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
      return { token, name: user.name, userId: user.id };
    });

    this.events.emit({
      event: 'auth.password_reset_requested',
      outcome: issued ? 'success' : 'failure',
      ...(issued ? { userId: issued.userId } : {}),
      ip,
    });
    if (!issued) return;
    const url = passwordResetLink(this.config.APP_BASE_URL ?? this.config.WEB_ORIGIN, issued.token);
    this.mail.dispatch({
      to: email,
      correlationId: resolveCorrelationId(this.cls.getId()),
      ...passwordResetEmail(issued.name, url),
    });
  }

  /** Consumes the link, sets the password and revokes every session of the user (FR-009). */
  async confirmReset(token: string, password: string, ip: string): Promise<void> {
    this.assertAcceptable(password);
    const passwordHash = await this.hasher.hash(password);

    const result = await this.database.withContext(
      { lookupTokenHash: hashTokenHex(token) },
      async (tx, extend) => {
        const [row] = await tx
          .select()
          .from(oneTimeTokens)
          .where(
            and(
              eq(oneTimeTokens.tokenHash, hashToken(token)),
              eq(oneTimeTokens.purpose, 'password_reset'),
              isNull(oneTimeTokens.consumedAt),
              gt(oneTimeTokens.expiresAt, sql`now()`),
            ),
          );
        if (!row) throw new TokenInvalidException();
        await extend({ userId: row.userId });
        // The conditional update makes the link usable once even under concurrent requests.
        const consumed = await tx
          .update(oneTimeTokens)
          .set({ consumedAt: sql`now()` })
          .where(and(eq(oneTimeTokens.id, row.id), isNull(oneTimeTokens.consumedAt)))
          .returning({ id: oneTimeTokens.id });
        if (consumed.length === 0) throw new TokenInvalidException();
        const changed = await tx
          .update(users)
          .set({ passwordHash })
          .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
          .returning({ id: users.id });
        if (changed.length === 0) throw new TokenInvalidException();
        const revoked = await this.sessionRepository.revokeAllOf(tx, row.userId, 'password_reset');
        return { userId: row.userId, revoked };
      },
    );
    await this.sessions.forgetCached(result.revoked);
    this.events.emit({
      event: 'auth.password_reset_completed',
      outcome: 'success',
      userId: result.userId,
      ip,
    });
  }

  /**
   * Changes the password of the signed-in user. A wrong current password counts toward a
   * progressive wait (like login) and the other sessions are revoked; the current one stays.
   */
  async change(
    auth: AuthSession,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    await this.rateLimit.assertNotBlocked(CHANGE_LIMIT, auth.userId);

    const [user] = await this.database.withContext({ userId: auth.userId }, (tx) =>
      active.users(tx, eq(users.id, auth.userId)),
    );
    const matches =
      user !== undefined && (await this.hasher.verify(user.passwordHash, currentPassword));
    if (!matches) {
      await this.rateLimit.recordFailure(CHANGE_LIMIT, auth.userId);
      this.events.emit({
        event: 'auth.password_changed',
        outcome: 'failure',
        userId: auth.userId,
        ip,
      });
      throw new InvalidCredentialsException();
    }

    this.assertAcceptable(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    const revoked = await this.database.withContext({ userId: auth.userId }, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.id, auth.userId), isNull(users.deletedAt)));
      return this.sessionRepository.revokeAllOf(
        tx,
        auth.userId,
        'password_change',
        Buffer.from(auth.tokenHash, 'hex'),
      );
    });
    await this.sessions.forgetCached(revoked);
    await this.rateLimit.clearFailures(CHANGE_LIMIT, auth.userId);
    this.events.emit({
      event: 'auth.password_changed',
      outcome: 'success',
      userId: auth.userId,
      ip,
    });
  }

  private assertAcceptable(password: string): void {
    const problems = this.policy.check(password);
    if (problems.length === 0) return;
    throw new DomainException(422, 'VALIDATION_FAILED', 'La solicitud contiene datos inválidos.', {
      errors: problems.map((message) => ({ field: 'password', message })),
    });
  }
}

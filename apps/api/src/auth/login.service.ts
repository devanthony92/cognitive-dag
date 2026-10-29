import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { active, type DatabaseClient } from '@cognitive-dag/db';
import type { LoginRequest, SessionInfo } from '@cognitive-dag/contracts';
import {
  DomainException,
  InvalidCredentialsException,
  RateLimitedException,
  ServiceUnavailableException,
} from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { PasswordHasher } from './password-hasher';
import { SessionInfoService } from './session-info.service';
import { SessionService, type CreatedSession } from './session.service';

const ACCOUNT_LIMIT = 'login:account';
const IP_LIMIT = 'login:ip';

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

export interface LoginResult {
  session: CreatedSession;
  info: SessionInfo;
}

@Injectable()
export class LoginService {
  /** Hash of a throwaway password, built with the production parameters (R12). */
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly sessionInfo: SessionInfoService,
    private readonly rateLimit: RateLimitService,
    private readonly events: SecurityEventLogger,
  ) {}

  /**
   * A wrong password, an unknown email and an unverified account end in the same 401 and cost the
   * same time: Argon2id always runs, against a dummy hash when there is no account (FR-006, FR-014).
   */
  async login(
    request: LoginRequest,
    context: { ip: string; userAgent?: string | undefined; previousToken?: string | undefined },
  ): Promise<LoginResult> {
    const accountKey = sha256Hex(request.email);
    await this.assertNotWaiting(accountKey, context.ip);

    const user = await this.findUser(request.email);
    const hash = user?.passwordHash ?? (await this.dummy());
    const passwordMatches = await this.hasher.verify(hash, request.password);

    if (!user || !passwordMatches || user.emailVerifiedAt === null) {
      await this.recordFailure(accountKey, context.ip);
      this.events.emit({
        event: 'auth.login_failed',
        outcome: 'failure',
        ip: context.ip,
        ...(user ? { userId: user.id } : {}),
      });
      throw new InvalidCredentialsException();
    }

    // Only the account counter is cleared: clearing the IP one would let an attacker with an
    // account of their own reset their wait between guesses against someone else's.
    await this.rateLimit.clearFailures(ACCOUNT_LIMIT, accountKey);
    const session = await this.sessions.create({
      userId: user.id,
      ip: context.ip,
      userAgent: context.userAgent,
      replacing: context.previousToken,
    });
    const info = await this.sessionInfo.build(user.id, session.csrfToken);
    this.events.emit({
      event: 'auth.login_succeeded',
      outcome: 'success',
      userId: user.id,
      ip: context.ip,
    });
    return { session, info };
  }

  private async assertNotWaiting(accountKey: string, ip: string): Promise<void> {
    try {
      await this.rateLimit.assertNotBlocked(ACCOUNT_LIMIT, accountKey);
      await this.rateLimit.assertNotBlocked(IP_LIMIT, ip);
    } catch (error) {
      if (error instanceof RateLimitedException) {
        this.events.emit({ event: 'auth.rate_limited', outcome: 'blocked', ip });
      }
      throw error;
    }
  }

  private async recordFailure(accountKey: string, ip: string): Promise<void> {
    await this.rateLimit.recordFailure(ACCOUNT_LIMIT, accountKey);
    await this.rateLimit.recordFailure(IP_LIMIT, ip);
  }

  private async findUser(email: string) {
    try {
      const [user] = await this.database.withContext({ lookupEmail: email }, (tx) =>
        active.users(tx),
      );
      return user;
    } catch (error) {
      if (error instanceof DomainException) throw error;
      throw new ServiceUnavailableException();
    }
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(randomBytes(24).toString('base64url'));
    return this.dummyHash;
  }
}

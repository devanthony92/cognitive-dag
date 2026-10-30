import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DomainException,
  ServiceUnavailableException,
  UnauthenticatedException,
} from '../common/errors/domain.exception';
import { generateToken, hashToken } from './one-time-token';
import { SessionCache } from './session.cache';
import { SessionRepository, type SessionRevokeReason } from './session.repository';

/** Absolute lifetime of a session (FR-008). */
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
/** Inactivity limit (FR-008): the TTL of the Valkey key, renewed on every request. */
export const SESSION_IDLE_TTL_SECONDS = 2 * 60 * 60;

export interface CreatedSession {
  /** Value of the session cookie. Never stored. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/** What the guards know about the caller once the cookie has been validated. */
export interface AuthSession {
  sessionId: string;
  userId: string;
  /** Hex SHA-256 of the session token. */
  tokenHash: string;
  csrfTokenHash: Buffer;
  csrfToken: string;
}

/**
 * The CSRF token is derived from the session token instead of being stored (only its hash is, per
 * data-model.md), so `GET /auth/session` can hand it out again after a page reload. It is as
 * unguessable as the session token itself and differs for every session.
 */
export function deriveCsrfToken(sessionToken: string): string {
  return createHash('sha256').update(`csrf:${sessionToken}`, 'utf8').digest('base64url');
}

@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly cache: SessionCache,
  ) {}

  /**
   * Opens a session. `replacing` is the cookie the browser already had: it is revoked, so a login
   * always rotates the session (FR-007, session fixation).
   */
  async create(input: {
    userId: string;
    ip: string;
    userAgent?: string | undefined;
    replacing?: string | undefined;
  }): Promise<CreatedSession> {
    const token = generateToken();
    const csrfToken = deriveCsrfToken(token);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);

    await this.guarded(() =>
      this.repository.insert({
        userId: input.userId,
        tokenHash,
        csrfTokenHash: hashToken(csrfToken),
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        expiresAt,
      }),
    );
    try {
      await this.cache.put(
        tokenHash.toString('hex'),
        {
          userId: input.userId,
          csrfTokenHash: hashToken(csrfToken).toString('hex'),
          expiresAt: expiresAt.toISOString(),
        },
        SESSION_IDLE_TTL_SECONDS,
      );
    } catch (error) {
      // Without its Valkey key the session could never be used: do not leave it behind.
      await this.repository.revoke(tokenHash, 'logout').catch(() => undefined);
      throw error;
    }

    if (input.replacing) await this.revoke(input.replacing, 'logout').catch(() => undefined);
    return { token, csrfToken, expiresAt };
  }

  /**
   * Valid = active in PostgreSQL (not revoked, inside 12 h) AND present in Valkey (idle < 2 h).
   * 401 when it is not; 503 when either store fails (fail closed, FR-011).
   */
  async authenticate(token: string): Promise<AuthSession> {
    const tokenHash = hashToken(token);
    const session = await this.guarded(() => this.repository.findActive(tokenHash));
    if (!session) throw new UnauthenticatedException();

    const present = await this.cache.touch(tokenHash.toString('hex'), SESSION_IDLE_TTL_SECONDS);
    if (!present) {
      // Idle for 2 h or Valkey was emptied: indistinguishable, so it counts as expired.
      await this.guarded(() => this.repository.revoke(tokenHash, 'idle_timeout'));
      throw new UnauthenticatedException();
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      tokenHash: tokenHash.toString('hex'),
      csrfTokenHash: session.csrfTokenHash,
      csrfToken: deriveCsrfToken(token),
    };
  }

  /**
   * PostgreSQL decides revocation, so it goes first and must succeed; dropping the Valkey key only
   * frees memory sooner and its failure cannot undo the revocation.
   */
  async revoke(token: string, reason: SessionRevokeReason): Promise<void> {
    const tokenHash = hashToken(token);
    await this.guarded(() => this.repository.revoke(tokenHash, reason));
    await this.cache.remove(tokenHash.toString('hex')).catch(() => undefined);
  }

  /**
   * Drops the Valkey keys of sessions already revoked in PostgreSQL. PostgreSQL decides, so a
   * failure here only leaves a key that expires on its own.
   */
  async forgetCached(tokenHashesHex: string[]): Promise<void> {
    await Promise.allSettled(tokenHashesHex.map((hash) => this.cache.remove(hash)));
  }

  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof DomainException) throw error;
      throw new ServiceUnavailableException();
    }
  }
}

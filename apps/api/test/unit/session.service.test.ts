import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomainException } from '../../src/common/errors/domain.exception';
import type { SessionCache } from '../../src/auth/session.cache';
import type {
  ActiveSession,
  NewSession,
  SessionRepository,
} from '../../src/auth/session.repository';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_SECONDS,
  SessionService,
} from '../../src/auth/session.service';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

class FakeRepository {
  rows = new Map<string, NewSession & { id: string; revokeReason?: string }>();
  failWith: Error | undefined;

  insert(row: NewSession): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.rows.set(row.tokenHash.toString('hex'), { ...row, id: `id-${this.rows.size + 1}` });
    return Promise.resolve();
  }

  findActive(tokenHash: Buffer): Promise<ActiveSession | undefined> {
    if (this.failWith) return Promise.reject(this.failWith);
    const row = this.rows.get(tokenHash.toString('hex'));
    if (!row || row.revokeReason || row.expiresAt.getTime() <= Date.now()) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({ id: row.id, userId: row.userId, csrfTokenHash: row.csrfTokenHash });
  }

  revoke(tokenHash: Buffer, reason: string): Promise<void> {
    const row = this.rows.get(tokenHash.toString('hex'));
    if (row && !row.revokeReason) row.revokeReason = reason;
    return Promise.resolve();
  }
}

class FakeCache {
  entries = new Map<string, { value: unknown; ttl: number }>();
  failWith: DomainException | undefined;

  put(key: string, value: unknown, ttl: number): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.entries.set(key, { value, ttl });
    return Promise.resolve();
  }

  touch(key: string): Promise<boolean> {
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(this.entries.has(key));
  }

  remove(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

describe('SessionService', () => {
  let repository: FakeRepository;
  let cache: FakeCache;
  let service: SessionService;

  beforeEach(() => {
    repository = new FakeRepository();
    cache = new FakeCache();
    service = new SessionService(
      repository as unknown as SessionRepository,
      cache as unknown as SessionCache,
    );
  });

  const login = (replacing?: string) =>
    service.create({ userId: 'user-1', ip: '203.0.113.7', userAgent: 'vitest', replacing });

  it('issues a 32-byte token and persists only its SHA-256', async () => {
    const created = await login();

    expect(Buffer.from(created.token, 'base64url')).toHaveLength(32);
    const [row] = [...repository.rows.values()];
    expect(row?.tokenHash.equals(sha256(created.token))).toBe(true);
    // Nothing handed to storage contains the token or the CSRF token in clear.
    const stored = JSON.stringify([...repository.rows.values(), [...cache.entries]]);
    expect(stored).not.toContain(created.token);
    expect(stored).not.toContain(created.csrfToken);
  });

  it('gives the session a CSRF token whose hash is the stored one', async () => {
    const created = await login();
    expect(created.csrfToken).toHaveLength(43);
    const [row] = [...repository.rows.values()];
    expect(row?.csrfTokenHash.equals(sha256(created.csrfToken))).toBe(true);
    const session = await service.authenticate(created.token);
    expect(session.csrfToken).toBe(created.csrfToken);
  });

  it('expires 12 hours after creation and tracks idleness for 2 hours in the cache', async () => {
    const before = Date.now();
    const created = await login();
    const lifetime = created.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThanOrEqual(SESSION_ABSOLUTE_TTL_MS);
    expect(lifetime).toBeLessThan(SESSION_ABSOLUTE_TTL_MS + 5_000);
    const entry = cache.entries.get(sha256(created.token).toString('hex'));
    expect(entry?.ttl).toBe(SESSION_IDLE_TTL_SECONDS);
    expect(SESSION_IDLE_TTL_SECONDS).toBe(2 * 60 * 60);
  });

  it('is valid only while PostgreSQL has it active and the cache holds its key', async () => {
    const created = await login();
    await expect(service.authenticate(created.token)).resolves.toMatchObject({
      userId: 'user-1',
    });

    cache.entries.clear();
    await expect(service.authenticate(created.token)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('revokes with idle_timeout when the cache key is missing', async () => {
    const created = await login();
    cache.entries.clear();

    await expect(service.authenticate(created.token)).rejects.toBeInstanceOf(DomainException);
    const [row] = [...repository.rows.values()];
    expect(row?.revokeReason).toBe('idle_timeout');
  });

  it('rejects an unknown token without touching the cache', async () => {
    await expect(service.authenticate('x'.repeat(43))).rejects.toMatchObject({ status: 401 });
    expect(cache.entries.size).toBe(0);
  });

  it('rejects a session past its absolute limit even if the cache still has the key', async () => {
    const created = await login();
    const [row] = [...repository.rows.values()];
    row!.expiresAt = new Date(Date.now() - 1_000);
    await expect(service.authenticate(created.token)).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed with 503 when the cache is down, and does not revoke', async () => {
    const created = await login();
    cache.failWith = new DomainException(503, 'SERVICE_UNAVAILABLE', 'down');
    await expect(service.authenticate(created.token)).rejects.toMatchObject({ status: 503 });
    expect([...repository.rows.values()][0]?.revokeReason).toBeUndefined();
  });

  it('fails closed with 503 when PostgreSQL fails', async () => {
    const created = await login();
    repository.failWith = new Error('connection refused');
    await expect(service.authenticate(created.token)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('does not leave a usable session when the cache is down at login', async () => {
    cache.failWith = new DomainException(503, 'SERVICE_UNAVAILABLE', 'down');
    await expect(login()).rejects.toMatchObject({ status: 503 });
    const [row] = [...repository.rows.values()];
    expect(row?.revokeReason).toBeDefined();
  });

  it('rotates: logging in again invalidates the previous token', async () => {
    const first = await login();
    const second = await login(first.token);

    expect(second.token).not.toBe(first.token);
    await expect(service.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
    await expect(service.authenticate(second.token)).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('revokes on logout and drops the cache key', async () => {
    const created = await login();
    await service.revoke(created.token, 'logout');

    expect([...repository.rows.values()][0]?.revokeReason).toBe('logout');
    expect(cache.entries.size).toBe(0);
    await expect(service.authenticate(created.token)).rejects.toMatchObject({ status: 401 });
  });
});

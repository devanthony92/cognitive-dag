import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import { resetRateLimits, startIdentityApp, uniqueEmail } from './identity-helpers';

// TEST-NET-3 addresses (RFC 5737): never a real client.
const CLIENT = '203.0.113.7';
const OTHER_CLIENT = '203.0.113.99';
const FORGED = '198.51.100.23';

/** The test client connects over loopback: that is the "proxy hop" the closed list trusts. */
const LOOPBACK_HOP = ['127.0.0.1', '::1'];

const failLogin = (app: INestApplication, forwardedFor?: string) => {
  const call = request(httpServer(app))
    .post('/api/v1/auth/login')
    .send({ email: uniqueEmail('proxy'), password: 'contraseña-incorrecta-123' });
  return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
};

describe('trust proxy (F9, FR-005; requires docker compose up and pnpm db:migrate)', () => {
  beforeEach(resetRateLimits);

  describe('with TRUSTED_PROXIES empty', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startIdentityApp(undefined, { TRUSTED_PROXIES: [] });
    });
    afterAll(() => app.close());

    it('ignores X-Forwarded-For: a rotating header does not evade the per-IP limit', async () => {
      for (let i = 0; i < 5; i += 1) await failLogin(app, `203.0.113.${i + 1}`).expect(401);
      await failLogin(app, OTHER_CLIENT).expect(429);
    });

    it('records the address of the connection, not the header, in the security events', async () => {
      const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
      await failLogin(app, FORGED).expect(401);
      const [event] = emit.mock.calls[0] ?? [];
      expect(event?.event).toBe('auth.login_failed');
      expect(event?.ip).not.toBe(FORGED);
      emit.mockRestore();
    });
  });

  describe('with the proxy hop trusted', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startIdentityApp(undefined, { TRUSTED_PROXIES: LOOPBACK_HOP });
    });
    afterAll(() => app.close());

    it('limits per client IP, not per proxy', async () => {
      for (let i = 0; i < 5; i += 1) await failLogin(app, CLIENT).expect(401);
      await failLogin(app, CLIENT).expect(429);
      // Another client behind the same proxy is not affected.
      await failLogin(app, OTHER_CLIENT).expect(401);
    });

    it('records the client IP in the security events', async () => {
      const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
      await failLogin(app, CLIENT).expect(401);
      expect(emit.mock.calls.map(([event]) => event)).toContainEqual(
        expect.objectContaining({ event: 'auth.login_failed', ip: CLIENT }),
      );
      emit.mockRestore();
    });

    it('does not let a client forge its IP by sending its own X-Forwarded-For', async () => {
      const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
      // The proxy appends the address it saw (CLIENT) after whatever the client sent.
      await failLogin(app, `${FORGED}, ${CLIENT}`).expect(401);
      const ips = emit.mock.calls.map(([event]) => event.ip);
      expect(ips).toContain(CLIENT);
      expect(ips).not.toContain(FORGED);
      emit.mockRestore();
    });

    it('falls back to the connection address without the header', async () => {
      const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
      await failLogin(app).expect(401);
      const [event] = emit.mock.calls[0] ?? [];
      expect(event?.ip).toMatch(/127\.0\.0\.1|::1/);
      emit.mockRestore();
    });
  });
});

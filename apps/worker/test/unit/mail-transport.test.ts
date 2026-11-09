import { describe, expect, it } from 'vitest';
import { buildTransportOptions } from '../../src/approvals/mail';

const BASE = { host: 'smtp.example.test', port: 587, from: 'CognitiveDAG <no-reply@example.test>' };

describe('worker SMTP transport options (F9, FR-030)', () => {
  it('keeps the development behaviour with Mailpit: no TLS and no authentication', () => {
    const options = buildTransportOptions({ ...BASE, host: '127.0.0.1', port: 1025 });
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBeUndefined();
    expect(options.auth).toBeUndefined();
  });

  it('supports implicit TLS, required STARTTLS and authentication', () => {
    expect(buildTransportOptions({ ...BASE, secure: 'true' }).secure).toBe(true);
    expect(buildTransportOptions({ ...BASE, secure: 'starttls' }).requireTLS).toBe(true);
    const options = buildTransportOptions({
      ...BASE,
      secure: 'starttls',
      auth: { user: 'smtp-user', password: 'smtp-pass' },
    });
    expect(options.auth).toEqual({ user: 'smtp-user', pass: 'smtp-pass' });
  });

  it('rejects a server without TLS in production', () => {
    expect(() =>
      buildTransportOptions({ ...BASE, production: true, auth: { user: 'u', password: 'p' } }),
    ).toThrow(/SMTP_SECURE/);
  });
});

import { describe, expect, it } from 'vitest';
import { buildTransportOptions } from '../../src/mail/smtp.mailer';

const BASE = { host: 'smtp.example.test', port: 587, from: 'CognitiveDAG <no-reply@example.test>' };

describe('SMTP transport options (F9, FR-030)', () => {
  it('keeps the development behaviour with Mailpit: no TLS and no authentication', () => {
    const options = buildTransportOptions({ ...BASE, host: '127.0.0.1', port: 1025 });
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBeUndefined();
    expect(options.auth).toBeUndefined();
    expect(options.host).toBe('127.0.0.1');
    expect(options.port).toBe(1025);
  });

  it('supports implicit TLS', () => {
    expect(buildTransportOptions({ ...BASE, secure: 'true' }).secure).toBe(true);
  });

  it('can require STARTTLS so a server without TLS is refused', () => {
    const options = buildTransportOptions({ ...BASE, secure: 'starttls' });
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it('sends the user and password when both are given', () => {
    const options = buildTransportOptions({
      ...BASE,
      secure: 'starttls',
      auth: { user: 'smtp-user', password: 'smtp-pass' },
    });
    expect(options.auth).toEqual({ user: 'smtp-user', pass: 'smtp-pass' });
  });

  it('rejects a server without TLS in production, naming the variable only', () => {
    try {
      buildTransportOptions({ ...BASE, production: true, auth: { user: 'u', password: 'p' } });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('SMTP_SECURE');
      expect((error as Error).message).not.toContain('smtp.example.test');
    }
  });

  it('rejects a production transport without authentication', () => {
    expect(() => buildTransportOptions({ ...BASE, production: true, secure: 'starttls' })).toThrow(
      /SMTP_USER_FILE/,
    );
  });

  it('accepts a production transport with TLS and authentication', () => {
    const options = buildTransportOptions({
      ...BASE,
      production: true,
      secure: 'true',
      auth: { user: 'u', password: 'p' },
    });
    expect(options.secure).toBe(true);
  });
});

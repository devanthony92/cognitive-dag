import { describe, expect, it } from 'vitest';
import {
  HTTP_ALLOWED_HOSTS_MAX,
  guardedRequest,
  isHostAllowed,
  validateAllowlistEntry,
} from '../src/index.js';
import { fakeDns } from './support/servers.js';

describe('allowlist entries (research R9.7)', () => {
  it.each([
    'api.example.com',
    'example.com',
    '*.partner.com',
    'a-b.c-d.example.org',
    'xn--bcher-kva.example',
  ])('accepts %s', (entry) => {
    expect(validateAllowlistEntry(entry)).toEqual({ ok: true, pattern: entry });
  });

  it.each([
    ['1.2.3.4', 'IP literal'],
    ['[::1]', 'IP literal'],
    ['*.1.2.3.4', 'IP literal'],
    ['https://api.example.com', 'scheme'],
    ['http://api.example.com', 'scheme'],
    ['api.example.com:8443', 'port'],
    ['api.example.com/path', 'path'],
    ['api.example.com?x=1', 'query'],
    ['user@api.example.com', 'user info'],
    ['API.example.com', 'upper case'],
    ['*', 'bare wildcard'],
    ['*.com', 'wildcard over a public suffix'],
    ['api.*.example.com', 'wildcard in the middle'],
    ['*example.com', 'wildcard without dot'],
    ['**.example.com', 'double wildcard'],
    ['localhost', 'single label'],
    ['', 'empty'],
    ['a..example.com', 'empty label'],
    ['-bad.example.com', 'leading hyphen'],
    ['bad_.example.com', 'underscore'],
    ['bücher.example', 'not ASCII'],
    ['api.example.com.', 'trailing dot'],
    [` api.example.com`, 'whitespace'],
    [`${'a'.repeat(64)}.example.com`, 'label over 63 characters'],
    [`${'a.'.repeat(130)}com`, 'longer than 253 characters'],
  ])('rejects %s (%s)', (entry) => {
    const result = validateAllowlistEntry(entry);
    expect(result.ok).toBe(false);
  });

  it('caps the list at 100 entries', () => {
    expect(HTTP_ALLOWED_HOSTS_MAX).toBe(100);
  });
});

describe('host matching (research R9.7)', () => {
  it('matches an exact host', () => {
    expect(isHostAllowed('api.example.com', ['api.example.com'])).toBe(true);
    expect(isHostAllowed('other.example.com', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('sub.api.example.com', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('api.example.com.evil.test', ['api.example.com'])).toBe(false);
  });

  it('matches *.domain on subdomains only, never on the base domain', () => {
    const list = ['*.partner.com'];
    expect(isHostAllowed('api.partner.com', list)).toBe(true);
    expect(isHostAllowed('a.b.partner.com', list)).toBe(true);
    expect(isHostAllowed('partner.com', list)).toBe(false);
    expect(isHostAllowed('evilpartner.com', list)).toBe(false);
    expect(isHostAllowed('partner.com.evil.test', list)).toBe(false);
  });

  it('compares without regard to case or a trailing dot', () => {
    expect(isHostAllowed('API.Example.COM', ['api.example.com'])).toBe(true);
    expect(isHostAllowed('api.example.com.', ['api.example.com'])).toBe(true);
  });

  it('rejects IP literals even when the list is not empty', () => {
    expect(isHostAllowed('1.2.3.4', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('[::1]', ['*.example.com'])).toBe(false);
  });

  it('an empty list is no restriction; a non-empty list restricts', () => {
    expect(isHostAllowed('anything.example', [])).toBe(true);
    expect(isHostAllowed('anything.example', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('api.example.com', ['x.example.com', 'api.example.com'])).toBe(true);
  });
});

describe('allowlist at the first request', () => {
  it('rejects a host outside a non-empty list before resolving the name', async () => {
    const resolve = fakeDns({ 'api.test': ['8.8.8.8'] });
    await expect(
      guardedRequest({
        url: 'https://api.test/',
        method: 'GET',
        allowlist: ['partner.com'],
        resolve,
      }),
    ).rejects.toMatchObject({ code: 'HTTP_HOST_NOT_ALLOWED', errorClass: 'permanent' });
    expect(resolve.calls.size).toBe(0);
  });

  it('does not put the host in the error message', async () => {
    try {
      await guardedRequest({
        url: 'https://secret-internal-name.test/',
        method: 'GET',
        allowlist: ['partner.com'],
        resolve: fakeDns({}),
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('El destino no está permitido.');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_CREDENTIAL_HEADER_NAMES,
  buildCredentialHeader,
  validateHeaderName,
} from '../src/index.js';

describe('credential headers (research R10)', () => {
  it('builds a bearer token', () => {
    expect(buildCredentialHeader({ kind: 'bearer', secret: 'abc123' })).toEqual({
      name: 'Authorization',
      value: 'Bearer abc123',
    });
  });

  it('builds an api key header with the chosen name', () => {
    expect(
      buildCredentialHeader({ kind: 'api_key_header', headerName: 'X-Api-Key', secret: 'k-1' }),
    ).toEqual({ name: 'X-Api-Key', value: 'k-1' });
  });

  it('builds basic auth from user:password', () => {
    expect(buildCredentialHeader({ kind: 'basic', secret: 'ana:p4ss:with:colons' })).toEqual({
      name: 'Authorization',
      value: `Basic ${Buffer.from('ana:p4ss:with:colons').toString('base64')}`,
    });
  });

  it('encodes basic auth as UTF-8', () => {
    const header = buildCredentialHeader({ kind: 'basic', secret: 'ñandú:clave' });
    expect(header.value).toBe(`Basic ${Buffer.from('ñandú:clave', 'utf8').toString('base64')}`);
  });

  it('needs a user and a colon in basic auth', () => {
    expect(() => buildCredentialHeader({ kind: 'basic', secret: 'nocolon' })).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_SECRET_INVALID' }),
    );
    expect(() => buildCredentialHeader({ kind: 'basic', secret: ':nouser' })).toThrow();
  });

  it('needs a header name for api_key_header and refuses it for the others', () => {
    expect(() => buildCredentialHeader({ kind: 'api_key_header', secret: 'k' })).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_HEADER_INVALID' }),
    );
    expect(() =>
      buildCredentialHeader({ kind: 'bearer', headerName: 'X-Api-Key', secret: 'k' }),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_HEADER_INVALID' }));
  });

  it.each(['a\r\nX-Injected: 1', 'a\nb', 'a\rb', 'a\u0000b'])(
    'refuses a secret that could split the header (%j)',
    (secret) => {
      expect(() => buildCredentialHeader({ kind: 'bearer', secret })).toThrowError(
        expect.objectContaining({ code: 'CREDENTIAL_SECRET_INVALID' }),
      );
      expect(() =>
        buildCredentialHeader({ kind: 'api_key_header', headerName: 'X-K', secret }),
      ).toThrow();
    },
  );

  it('does not echo the secret in the error', () => {
    try {
      buildCredentialHeader({ kind: 'bearer', secret: 'leaky\nsecret' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('leaky');
    }
  });
});

describe('forbidden header names', () => {
  it('lists the names of research R10', () => {
    expect([...FORBIDDEN_CREDENTIAL_HEADER_NAMES].sort()).toEqual(
      [
        'authorization',
        'connection',
        'content-length',
        'content-type',
        'cookie',
        'host',
        'idempotency-key',
        'set-cookie',
        'transfer-encoding',
      ].sort(),
    );
  });

  it.each([
    'Host',
    'host',
    'HOST',
    'Content-Length',
    'Content-Type',
    'Transfer-Encoding',
    'Connection',
    'Cookie',
    'Set-Cookie',
    'Authorization',
    'AUTHORIZATION',
    'Idempotency-Key',
    'Proxy-Authorization',
    'proxy-connection',
    'Proxy-Anything',
  ])('rejects %s as the name of an api key header', (name) => {
    expect(() =>
      buildCredentialHeader({ kind: 'api_key_header', headerName: name, secret: 'k' }),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_HEADER_INVALID' }));
    expect(validateHeaderName(name).ok).toBe(false);
  });

  it.each(['X-Api-Key', 'api-key', 'X-Auth-Token', 'Ocp-Apim-Subscription-Key'])(
    'accepts %s',
    (name) => {
      expect(validateHeaderName(name)).toEqual({ ok: true });
    },
  );

  it.each(['', 'has space', 'bad:name', 'bad\r\nname', 'ñandú', 'a'.repeat(65), 'x(y)'])(
    'rejects the malformed name %j',
    (name) => {
      expect(validateHeaderName(name).ok).toBe(false);
    },
  );
});

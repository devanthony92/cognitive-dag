import { describe, expect, it } from 'vitest';
import { buildTemporalTls } from '../../src/temporal/temporal-tls';

const FILES: Record<string, string> = {
  '/run/s/ca.pem': 'ca-contents',
  '/run/s/cert.pem': 'cert-contents',
  '/run/s/key.pem': 'key-contents',
};
const read = (path: string): string => {
  const contents = FILES[path];
  if (contents === undefined) throw new Error(`ENOENT ${path}`);
  return contents;
};

const FULL = {
  caFile: '/run/s/ca.pem',
  certFile: '/run/s/cert.pem',
  keyFile: '/run/s/key.pem',
  serverName: 'temporal',
};

describe('Temporal client TLS options (F9, FR-008)', () => {
  it('includes the CA, the client certificate pair and the server name', () => {
    const tls = buildTemporalTls(FULL, read);
    expect(tls?.serverNameOverride).toBe('temporal');
    expect(tls?.serverRootCACertificate.toString()).toBe('ca-contents');
    expect(tls?.clientCertPair.crt.toString()).toBe('cert-contents');
    expect(tls?.clientCertPair.key.toString()).toBe('key-contents');
  });

  it('omits the server name override when it is not configured', () => {
    const tls = buildTemporalTls({ ...FULL, serverName: undefined }, read);
    expect(tls).toBeDefined();
    expect(tls).not.toHaveProperty('serverNameOverride');
  });

  it('is off when nothing is configured (development)', () => {
    expect(buildTemporalTls({}, read)).toBeUndefined();
  });

  it.each([
    [{ caFile: FULL.caFile }, ['TEMPORAL_TLS_CERT_FILE', 'TEMPORAL_TLS_KEY_FILE']],
    [{ certFile: FULL.certFile, keyFile: FULL.keyFile }, ['TEMPORAL_TLS_CA_FILE']],
    [{ ...FULL, keyFile: undefined }, ['TEMPORAL_TLS_KEY_FILE']],
    [
      { serverName: 'temporal' },
      ['TEMPORAL_TLS_CA_FILE', 'TEMPORAL_TLS_CERT_FILE', 'TEMPORAL_TLS_KEY_FILE'],
    ],
  ])('rejects an incomplete configuration %#', (partial, missing) => {
    try {
      buildTemporalTls(partial, read);
      expect.unreachable();
    } catch (error) {
      expect((error as { variables: string[] }).variables).toEqual(missing);
    }
  });

  it('names the variable of a file that cannot be read', () => {
    try {
      buildTemporalTls({ ...FULL, keyFile: '/run/s/missing.pem' }, read);
      expect.unreachable();
    } catch (error) {
      expect((error as { variables: string[] }).variables).toEqual(['TEMPORAL_TLS_KEY_FILE']);
      expect((error as Error).message).not.toContain('key-contents');
    }
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestCertificate {
  key: string;
  cert: string;
}

let cached: TestCertificate | undefined;

// `openssl` on the PATH (CI and Linux); the copy that ships with Git for Windows otherwise.
const OPENSSL_CANDIDATES = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe'];

function runOpenssl(args: string[]): void {
  let lastError: unknown;
  for (const binary of OPENSSL_CANDIDATES) {
    try {
      execFileSync(binary, args, { stdio: 'ignore' });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('openssl is required to generate the throwaway test certificate', {
    cause: lastError,
  });
}

/**
 * Self-signed certificate for the local test servers, generated per run in the temp folder. Nothing
 * is committed: no key material lives in the repository.
 */
export function testCertificate(): TestCertificate {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), 'connectors-tls-'));
  try {
    const config = join(dir, 'openssl.cnf');
    writeFileSync(
      config,
      [
        '[req]',
        'distinguished_name=dn',
        'x509_extensions=ext',
        'prompt=no',
        '[dn]',
        'CN=api.test',
        '[ext]',
        'subjectAltName=DNS:api.test,DNS:other.test,DNS:localhost,IP:127.0.0.1',
      ].join('\n'),
    );
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    runOpenssl([
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
      '-config',
      config,
    ]);
    cached = { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
    return cached;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

/** Reads a file as text. Injected into `parseEnv` so tests need no files on disk. */
export type FileReader = (path: string) => string;

export const readTextFile: FileReader = (path) => readFileSync(path, 'utf8');

export class InvalidConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidConfigError';
  }
}

/** Credentials of the Valkey user of the application (ACL) and the CA that signs its server. */
export interface ValkeyAuth {
  username?: string;
  password?: string;
  ca?: string;
}

export interface SmtpAuth {
  user: string;
  password: string;
}

/** An unset variable and an empty one (Compose passes `NAME=`) both mean "not configured". */
export function valueOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Content of the secret file that `<name>` points to. A file that cannot be read, or is empty, marks
 * the variable invalid: its path and its contents never reach a message. A trailing newline is not
 * part of the secret.
 */
export function readSecretFile(
  env: NodeJS.ProcessEnv,
  name: string,
  read: FileReader,
  invalid: Set<string>,
): string | undefined {
  const path = valueOf(env, name);
  if (path === undefined) return undefined;
  try {
    const contents = read(path).replace(/[\r\n]+$/, '');
    if (contents !== '') return contents;
  } catch {
    // Falls through: the variable is reported, the error text may hold the path.
  }
  invalid.add(name);
  return undefined;
}

/** Passwords that ship in the repository for local development: never valid in production. */
const DEVELOPMENT_PASSWORDS = new Set([
  'app_runtime_dev_only',
  'app_migrator_dev_only',
  'local_dev_only',
]);

export function isDevelopmentPassword(value: string): boolean {
  return DEVELOPMENT_PASSWORDS.has(value.toLowerCase()) || /dev[_-]?only/i.test(value);
}

/** An address or a CIDR range; the proxy keywords of Express (`loopback`...) are not a closed list. */
export function isProxyEntry(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0 || address === undefined) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

export function parseTrustedProxies(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Whether a PostgreSQL URL demands a verified TLS connection against a given CA. */
export function requiresVerifiedTls(url: URL): boolean {
  const root = url.searchParams.get('sslrootcert');
  return url.searchParams.get('sslmode') === 'verify-full' && root !== null && root !== '';
}

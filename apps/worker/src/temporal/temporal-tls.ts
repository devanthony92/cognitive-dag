import { InvalidConfigError, type FileReader } from '../config/secrets';

/** Files of the mTLS connection to the Temporal frontend (FR-008). */
export interface TemporalTlsFiles {
  caFile?: string | undefined;
  certFile?: string | undefined;
  keyFile?: string | undefined;
  serverName?: string | undefined;
}

/** Shape of the SDK's `TLSConfig`, with every part present. */
export interface TemporalTls {
  serverNameOverride?: string;
  serverRootCACertificate: Buffer;
  clientCertPair: { crt: Buffer; key: Buffer };
}

const VARIABLES = {
  caFile: 'TEMPORAL_TLS_CA_FILE',
  certFile: 'TEMPORAL_TLS_CERT_FILE',
  keyFile: 'TEMPORAL_TLS_KEY_FILE',
} as const;

/**
 * TLS options for the Temporal client: the CA that signs the server, the client certificate pair and
 * the name the server certificate must carry. Nothing configured means no TLS (development); a
 * partial configuration is refused naming the missing variables, and a file that cannot be read
 * names its variable without the path or the contents.
 */
export function buildTemporalTls(
  files: TemporalTlsFiles,
  read: FileReader,
): TemporalTls | undefined {
  const configured = [files.caFile, files.certFile, files.keyFile, files.serverName].some(
    (value) => value !== undefined && value !== '',
  );
  if (!configured) return undefined;

  const missing = (Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]).filter(
    (key) => files[key] === undefined || files[key] === '',
  );
  if (missing.length > 0) throw new InvalidConfigError(missing.map((key) => VARIABLES[key]).sort());

  const unreadable: string[] = [];
  const load = (key: keyof typeof VARIABLES): Buffer => {
    try {
      return Buffer.from(read(files[key]!));
    } catch {
      unreadable.push(VARIABLES[key]);
      return Buffer.alloc(0);
    }
  };
  const ca = load('caFile');
  const crt = load('certFile');
  const key = load('keyFile');
  if (unreadable.length > 0) throw new InvalidConfigError(unreadable.sort());

  return {
    ...(files.serverName ? { serverNameOverride: files.serverName } : {}),
    serverRootCACertificate: ca,
    clientCertPair: { crt, key },
  };
}

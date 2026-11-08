import { randomBytes, randomUUID } from 'node:crypto';
import type { RequestListener } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { encryptSecret } from '@cognitive-dag/connectors';
import { credentials, httpAllowedHosts, sql, type WithContext } from '@cognitive-dag/db';
import type { CredentialKind } from '@cognitive-dag/connectors';
import { testCertificate } from './tls';

export const MASTER_KEY = randomBytes(32);

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface LocalServer {
  port: number;
  /** Requests received, in order. */
  requests: RecordedRequest[];
  /** The certificate to trust. */
  ca: string;
  url(path?: string): string;
  close(): Promise<void>;
}

/** A local https server: the real client talks TLS to it, and nothing leaves the machine. */
export async function startLocalServer(handler: RequestListener): Promise<LocalServer> {
  const { key, cert } = testCertificate();
  const requests: RecordedRequest[] = [];
  const server: Server = createServer({ key, cert }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    ca: cert,
    url: (path = '/') => `https://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Inserts a credential encrypted with `MASTER_KEY`, as the API will; returns its id. */
export async function insertCredential(
  withContext: WithContext,
  options: {
    organizationId: string;
    userId: string;
    kind?: CredentialKind;
    headerName?: string;
    secret?: string;
    archived?: boolean;
    name?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const encrypted = encryptSecret({
    credentialId: id,
    organizationId: options.organizationId,
    masterKey: MASTER_KEY,
    secret: options.secret ?? 'tok-secret-123',
  });
  await withContext(
    { organizationId: options.organizationId, userId: options.userId },
    async (tx) => {
      await tx.insert(credentials).values({
        id,
        organizationId: options.organizationId,
        name: options.name ?? `cred-${id.slice(0, 8)}`,
        kind: options.kind ?? 'bearer',
        headerName: options.headerName ?? null,
        ...encrypted,
        createdBy: options.userId,
      });
      if (options.archived) {
        // The guard trigger freezes an archived row, so it is archived the way the API does it.
        await tx.execute(
          sql`UPDATE credentials SET archived_by = ${options.userId}, archived_at = now() WHERE id = ${id}`,
        );
      }
    },
  );
  return id;
}

export async function insertAllowedHost(
  withContext: WithContext,
  options: { organizationId: string; userId: string; pattern: string },
): Promise<void> {
  await withContext({ organizationId: options.organizationId, userId: options.userId }, (tx) =>
    tx.insert(httpAllowedHosts).values({
      organizationId: options.organizationId,
      pattern: options.pattern,
      createdBy: options.userId,
    }),
  );
}

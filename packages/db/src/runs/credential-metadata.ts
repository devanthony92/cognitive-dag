import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { credentialMetadata, credentials } from '../schema/index.js';
import type { Tx } from '../tenant.js';

/**
 * Credentials without their secret (T025): the only read of the table the API makes. The `bytea`
 * columns are read by the worker when it runs a node and by the API only to write.
 */
export function listCredentialMetadata(tx: Tx, organizationId: string, where?: SQL) {
  return tx
    .select(credentialMetadata)
    .from(credentials)
    .where(
      and(eq(credentials.organizationId, organizationId), isNull(credentials.archivedAt), where),
    )
    .orderBy(desc(credentials.createdAt));
}

/** One credential, live or archived, by id; still without the secret. */
export function findCredentialMetadata(tx: Tx, organizationId: string, credentialId: string) {
  return tx
    .select(credentialMetadata)
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.id, credentialId)));
}

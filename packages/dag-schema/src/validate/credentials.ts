import type { DagDefinition } from '../definition.js';
import type { DagError } from '../validate.js';

/**
 * Which of the given credential ids the caller can use: they exist, are not archived and belong to
 * the organization that publishes. The API answers it from the database, under row-level security.
 */
export type UsableCredentials = (ids: readonly string[]) => Promise<ReadonlySet<string>>;

/**
 * Publication check of the credentials a definition references (F7, research R10). Each
 * `http.request` node whose `credentialId` is not usable gets `CREDENTIAL_NOT_FOUND`. The message
 * does not repeat the id, so the answer cannot be used to probe other organizations. A failure of
 * the resolver propagates: publishing fails closed.
 */
export async function validateCredentialReferences(
  definition: DagDefinition,
  usable: UsableCredentials,
): Promise<DagError[]> {
  const references: { node: string; credentialId: string }[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'http.request') continue;
    const credentialId = (node.config as { credentialId?: string }).credentialId;
    if (credentialId !== undefined) references.push({ node: node.id, credentialId });
  }
  if (references.length === 0) return [];

  const found = await usable([...new Set(references.map((reference) => reference.credentialId))]);
  return references
    .filter((reference) => !found.has(reference.credentialId))
    .map((reference) => ({
      code: 'CREDENTIAL_NOT_FOUND',
      message: 'La credencial elegida no existe, está archivada o no pertenece a la organización.',
      location: { node: reference.node, field: 'config.credentialId' },
    }));
}

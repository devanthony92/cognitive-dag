import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { inContext, type Tenant } from './helpers.js';

export const EMPTY_DEFINITION = '{"schemaVersion":1,"nodes":[],"edges":[]}';

export function ctx(tenant: Tenant) {
  return { userId: tenant.userId, organizationId: tenant.organizationId };
}

export async function createWorkflow(pool: pg.Pool, tenant: Tenant, name: string): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [tenant.organizationId, name, tenant.userId],
    );
    const id = rows[0]!.id;
    await client.query(
      'INSERT INTO workflow_active_versions (workflow_id, organization_id) VALUES ($1, $2)',
      [id, tenant.organizationId],
    );
    return id;
  });
}

export async function publishVersion(
  pool: pg.Pool,
  tenant: Tenant,
  workflowId: string,
  versionNumber = 1,
): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflow_versions
         (organization_id, workflow_id, version_number, definition, definition_hash,
          node_count, edge_count, node_types, published_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 1, 0, ARRAY['trigger.manual'], $6) RETURNING id`,
      [
        tenant.organizationId,
        workflowId,
        versionNumber,
        EMPTY_DEFINITION,
        createHash('sha256').update(`${EMPTY_DEFINITION}${versionNumber}`).digest(),
        tenant.userId,
      ],
    );
    return rows[0]!.id;
  });
}

/** Points the workflow at a version, as activating it does. */
export async function activateVersion(
  pool: pg.Pool,
  tenant: Tenant,
  workflowId: string,
  versionId: string,
): Promise<void> {
  await inContext(pool, ctx(tenant), async (client) => {
    await client.query(
      `UPDATE workflow_active_versions
         SET version_id = $2, activated_by = $3, activated_at = now()
       WHERE workflow_id = $1`,
      [workflowId, versionId, tenant.userId],
    );
  });
}

export interface RunInsert {
  organizationId?: string;
  status?: string;
  triggeredBy?: string | null;
  triggerKind?: string;
  triggerEventId?: string | null;
  scheduledAt?: string | null;
  rerunOf?: string | null;
}

/** Inserts a run the way the API (or the launcher) does, in `queued`. */
export async function insertRun(
  client: pg.PoolClient,
  tenant: Tenant,
  workflowId: string,
  versionId: string,
  options: RunInsert = {},
): Promise<string> {
  const id = randomUUID();
  const kind = options.triggerKind ?? 'manual';
  await client.query(
    `INSERT INTO workflow_runs
       (id, organization_id, workflow_id, version_id, version_number, status, triggered_by,
        trigger_kind, trigger_event_id, scheduled_at, rerun_of, correlation_id,
        temporal_workflow_id)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      options.organizationId ?? tenant.organizationId,
      workflowId,
      versionId,
      options.status ?? 'queued',
      options.triggeredBy === undefined ? tenant.userId : options.triggeredBy,
      kind,
      options.triggerEventId ?? null,
      options.scheduledAt ?? null,
      options.rerunOf ?? null,
      randomUUID(),
      `${kind === 'webhook' ? 'hook' : 'run'}-${id}`,
    ],
  );
  return id;
}

export function randomHash(): Buffer {
  return randomBytes(32);
}

/** The columns of a credential with plausible sizes; the content is random bytes. */
export function credentialColumns(
  tenant: Tenant,
  overrides: Partial<{
    organizationId: string;
    name: string;
    kind: string;
    headerName: string | null;
    secretCt: Buffer;
    createdBy: string;
  }> = {},
): unknown[] {
  return [
    overrides.organizationId ?? tenant.organizationId,
    overrides.name ?? `cred-${randomUUID().slice(0, 8)}`,
    overrides.kind ?? 'bearer',
    overrides.headerName ?? null,
    randomBytes(32),
    randomBytes(12),
    randomBytes(16),
    overrides.secretCt ?? randomBytes(40),
    randomBytes(12),
    randomBytes(16),
    overrides.createdBy ?? tenant.userId,
  ];
}

export const CREDENTIAL_INSERT = `INSERT INTO credentials
  (organization_id, name, kind, header_name, dek_wrapped, dek_iv, dek_tag, secret_ct, secret_iv,
   secret_tag, created_by)
  VALUES ($1, $2, $3::credential_kind, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`;

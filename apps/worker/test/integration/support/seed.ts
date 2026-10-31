import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface SeededRun {
  organizationId: string;
  userId: string;
  workflowId: string;
  versionId: string;
  runId: string;
}

async function inTransaction<T>(
  pool: pg.Pool,
  settings: Record<string, string>,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [name, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [name, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * What registration, publication and the API's start do, as `app_runtime` (the role of the
 * worker): a user, its organization, a workflow with one version and a `queued` run.
 */
export async function seedRun(pool: pg.Pool, definition: unknown): Promise<SeededRun> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  const body = JSON.stringify(definition);

  await inTransaction(
    pool,
    { 'app.user_id': userId, 'app.organization_id': organizationId },
    async (client) => {
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, `worker-${userId}@example.test`, 'worker test', '$argon2id$test'],
      );
      await client.query(
        'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, true, $3)',
        [organizationId, `Personal ${userId.slice(0, 8)}`, userId],
      );
      await client.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
        [organizationId, userId],
      );
      await client.query(
        `INSERT INTO workflows (id, organization_id, name, draft_updated_by, created_by)
         VALUES ($1, $2, $3, $4, $4)`,
        [workflowId, organizationId, `Flujo ${runId.slice(0, 8)}`, userId],
      );
      await client.query(
        `INSERT INTO workflow_versions
           (id, organization_id, workflow_id, version_number, definition, definition_hash,
            node_count, edge_count, node_types, published_by)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5, 1, 0, ARRAY['trigger.manual'], $6)`,
        [
          versionId,
          organizationId,
          workflowId,
          body,
          createHash('sha256').update(body).digest(),
          userId,
        ],
      );
      await client.query(
        `INSERT INTO workflow_runs
           (id, organization_id, workflow_id, version_id, version_number, triggered_by,
            correlation_id, temporal_workflow_id)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
        [runId, organizationId, workflowId, versionId, userId, randomUUID(), `run-${runId}`],
      );
    },
  );
  return { organizationId, userId, workflowId, versionId, runId };
}

export interface RunRow {
  status: string;
  error_code: string | null;
  error_message: string | null;
  error_class: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface StepRow {
  node_id: string;
  node_type: string;
  status: string;
  attempts: number;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  error_code: string | null;
  error_class: string | null;
  waiting_reason: string | null;
}

export async function readRun(
  pool: pg.Pool,
  run: SeededRun,
): Promise<{ run: RunRow | undefined; steps: StepRow[] }> {
  return inTransaction(pool, { 'app.organization_id': run.organizationId }, async (client) => {
    const runs = await client.query<RunRow>(
      `SELECT status, error_code, error_message, error_class, started_at, finished_at
         FROM workflow_runs WHERE id = $1`,
      [run.runId],
    );
    const steps = await client.query<StepRow>(
      `SELECT node_id, node_type, status, attempts, started_at, finished_at, duration_ms, error_code,
              error_class, waiting_reason
         FROM workflow_run_steps WHERE run_id = $1 ORDER BY node_id`,
      [run.runId],
    );
    return { run: runs.rows[0], steps: steps.rows };
  });
}

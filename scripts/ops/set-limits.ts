import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { ABSOLUTE_LIMITS, DEFAULT_LIMITS, type DagLimits } from '@cognitive-dag/dag-schema';
import { DEFAULT_MAX_CONCURRENT_RUNS } from '@cognitive-dag/contracts';
import { createLogger, type Logger } from '@cognitive-dag/logger';

/**
 * Operator script: sets the DAG limits of one organization (FR-021, research R12).
 *
 *   pnpm ops:set-limits <organizationId> [--max-nodes N] [--max-edges N]
 *                       [--max-definition-bytes N] [--max-concurrent-runs N]
 *                       [--operator NAME]
 *
 * It connects as `app_migrator` (DATABASE_MIGRATOR_URL), never through the API: no endpoint writes
 * limits. Values are validated against the ceilings of the platform (and against the lower ones
 * in DAG_MAX_*_CEILING, if the server sets them). Every change is logged with who, when, the
 * organization and the old and new values.
 */

const USAGE =
  'Usage: pnpm ops:set-limits <organizationId> [--max-nodes N] [--max-edges N] ' +
  '[--max-definition-bytes N] [--max-concurrent-runs N] [--operator NAME]';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UsageError extends Error {}

/** Everything the operator can set: the DAG limits (F2) and the runs in progress (F3). */
export interface OrganizationLimits extends DagLimits {
  maxConcurrentRuns: number;
}

/** Highest value the database accepts for `max_concurrent_runs`. */
const MAX_CONCURRENT_RUNS_CEILING = 100;

export interface LimitsRequest {
  organizationId: string;
  operator: string;
  /** Only the values the operator gave; the rest keep their current value. */
  changes: Partial<OrganizationLimits>;
}

interface Bound {
  key: keyof OrganizationLimits;
  flag: string;
  /** Variable of the server configuration that can lower the ceiling, if any. */
  env?: string;
  min: number;
  ceiling: number;
}

const BOUNDS: Bound[] = [
  {
    key: 'maxNodes',
    flag: 'max-nodes',
    env: 'DAG_MAX_NODES_CEILING',
    min: 1,
    ceiling: ABSOLUTE_LIMITS.maxNodes,
  },
  {
    key: 'maxEdges',
    flag: 'max-edges',
    env: 'DAG_MAX_EDGES_CEILING',
    min: 0,
    ceiling: ABSOLUTE_LIMITS.maxEdges,
  },
  {
    key: 'maxDefinitionBytes',
    flag: 'max-definition-bytes',
    env: 'DAG_MAX_DEFINITION_BYTES_CEILING',
    min: 1024,
    ceiling: ABSOLUTE_LIMITS.maxDefinitionBytes,
  },
  {
    key: 'maxConcurrentRuns',
    flag: 'max-concurrent-runs',
    min: 1,
    ceiling: MAX_CONCURRENT_RUNS_CEILING,
  },
];

/** The ceilings in force: the platform maximum, lowered by the server configuration if set. */
export function ceilingsFrom(env: NodeJS.ProcessEnv): DagLimits {
  const result: DagLimits = { ...ABSOLUTE_LIMITS };
  for (const bound of BOUNDS) {
    if (bound.env === undefined || bound.key === 'maxConcurrentRuns') continue;
    const raw = env[bound.env];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < bound.min || value > bound.ceiling) {
      throw new UsageError(
        `${bound.env} must be an integer between ${bound.min} and ${bound.ceiling}.`,
      );
    }
    result[bound.key] = value;
  }
  return result;
}

export function parseRequest(
  argv: string[],
  env: NodeJS.ProcessEnv,
  defaultOperator: () => string,
): LimitsRequest {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'max-nodes': { type: 'string' },
        'max-edges': { type: 'string' },
        'max-definition-bytes': { type: 'string' },
        'max-concurrent-runs': { type: 'string' },
        operator: { type: 'string' },
      },
    });
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError(`Expected one organization id.\n${USAGE}`);
  const organizationId = (positionals[0] as string).toLowerCase();
  if (!UUID.test(organizationId)) throw new UsageError('The organization id must be a UUID.');

  const ceilings = ceilingsFrom(env);
  const changes: Partial<OrganizationLimits> = {};
  for (const bound of BOUNDS) {
    const raw = values[bound.flag as keyof typeof values];
    if (raw === undefined) continue;
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    const ceiling = bound.key === 'maxConcurrentRuns' ? bound.ceiling : ceilings[bound.key];
    if (!Number.isSafeInteger(value) || value < bound.min || value > ceiling) {
      throw new UsageError(
        `--${bound.flag} must be an integer between ${bound.min} and ${ceiling}, got "${raw}".`,
      );
    }
    changes[bound.key] = value;
  }
  if (Object.keys(changes).length === 0) {
    throw new UsageError(`Give at least one limit to change.\n${USAGE}`);
  }

  const operator = (values.operator ?? env['OPS_OPERATOR'] ?? defaultOperator()).trim();
  if (operator.length < 1 || operator.length > 100) {
    throw new UsageError('The operator must have 1 to 100 characters.');
  }
  return { organizationId, operator, changes };
}

interface LimitsRow {
  max_nodes: number;
  max_edges: number;
  max_definition_bytes: number;
  max_concurrent_runs: number;
}

const fromRow = (row: LimitsRow): OrganizationLimits => ({
  maxNodes: row.max_nodes,
  maxEdges: row.max_edges,
  maxDefinitionBytes: row.max_definition_bytes,
  maxConcurrentRuns: row.max_concurrent_runs,
});

export interface LimitsChange {
  organizationId: string;
  operator: string;
  /** `null`: the organization had no limits of its own (the platform defaults applied). */
  old: OrganizationLimits | null;
  new: OrganizationLimits;
}

/**
 * Writes the limits in one transaction. `app_migrator` owns the table and writes it through the
 * policy `organization_limits_operator`; FORCE ROW LEVEL SECURITY stays on.
 */
export async function applyLimits(pool: pg.Pool, request: LimitsRequest): Promise<LimitsChange> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<LimitsRow>(
      `SELECT max_nodes, max_edges, max_definition_bytes, max_concurrent_runs
         FROM organization_limits WHERE organization_id = $1 FOR UPDATE`,
      [request.organizationId],
    );
    const old = current.rows[0] ? fromRow(current.rows[0]) : null;
    const next: OrganizationLimits = {
      ...(old ?? { ...DEFAULT_LIMITS, maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS }),
      ...request.changes,
    };

    await client.query(
      `INSERT INTO organization_limits
         (organization_id, max_nodes, max_edges, max_definition_bytes, max_concurrent_runs,
          updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (organization_id) DO UPDATE SET
         max_nodes = EXCLUDED.max_nodes,
         max_edges = EXCLUDED.max_edges,
         max_definition_bytes = EXCLUDED.max_definition_bytes,
         max_concurrent_runs = EXCLUDED.max_concurrent_runs,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        request.organizationId,
        next.maxNodes,
        next.maxEdges,
        next.maxDefinitionBytes,
        next.maxConcurrentRuns,
        request.operator,
      ],
    );
    await client.query('COMMIT');
    return { organizationId: request.organizationId, operator: request.operator, old, new: next };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23503') {
      throw new UsageError(`Organization ${request.organizationId} does not exist.`);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** One log line per change: who (operator), when (log time), which organization, old and new. */
export function logChange(logger: Logger, change: LimitsChange): void {
  logger.info(
    {
      event: 'ops.limits_changed',
      operator: change.operator,
      organizationId: change.organizationId,
      old: change.old,
      new: change.new,
    },
    'Organization limits changed',
  );
}

function loadRepositoryEnv(): void {
  const file = resolve(import.meta.dirname, '../../.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export async function main(argv: string[]): Promise<number> {
  loadRepositoryEnv();
  const logger = createLogger({ component: 'ops', level: 'info' });
  try {
    const request = parseRequest(argv, process.env, () => userInfo().username);
    const url = process.env['DATABASE_MIGRATOR_URL'];
    if (!url) throw new UsageError('DATABASE_MIGRATOR_URL is required.');
    const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    try {
      logChange(logger, await applyLimits(pool, request));
    } finally {
      await pool.end();
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    logger.error({ err: error }, 'Could not change the limits');
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}

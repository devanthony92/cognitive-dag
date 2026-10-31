import {
  active,
  inArray,
  users,
  type Tx,
  type workflowRunSteps,
  type workflowRuns,
} from '@cognitive-dag/db';
import {
  ErrorClassSchema,
  FINAL_RUN_STATUSES,
  type ErrorClass,
  type Run,
  type RunStep,
} from '@cognitive-dag/contracts';

type RunRow = typeof workflowRuns.$inferSelect;
type StepRow = typeof workflowRunSteps.$inferSelect;

const isErrorClass = (value: string | null): value is ErrorClass =>
  ErrorClassSchema.safeParse(value).success;

const UNKNOWN_USER = 'Usuario desconocido';

export const isFinal = (status: string): boolean =>
  (FINAL_RUN_STATUSES as readonly string[]).includes(status);

export async function userNames(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await active.users(tx, inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

const errorOf = (code: string | null, message: string | null, errorClass: string | null) =>
  code === null
    ? null
    : {
        code,
        message: message ?? '',
        ...(isErrorClass(errorClass) ? { class: errorClass } : {}),
      };

export function toRun(row: RunRow, names: Map<string, string>): Run {
  return {
    id: row.id,
    workflowId: row.workflowId,
    versionNumber: row.versionNumber,
    status: row.status,
    triggeredBy: { id: row.triggeredBy, name: names.get(row.triggeredBy) ?? UNKNOWN_USER },
    rerunOf: row.rerunOf,
    rerunFromNodeId: row.rerunFromNodeId,
    correlationId: row.correlationId,
    error: errorOf(row.errorCode, row.errorMessage, row.errorClass),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function toStep(row: StepRow): RunStep {
  return {
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    status: row.status,
    attempts: row.attempts,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    error: errorOf(row.errorCode, row.errorMessage, row.errorClass),
    waitingReason: row.waitingReason === 'rate_limited' ? 'rate_limited' : null,
  };
}

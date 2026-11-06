import { ErrorClassSchema, type Compilation } from '@cognitive-dag/contracts';
import type { compilations } from '@cognitive-dag/db';

type CompilationRow = typeof compilations.$inferSelect;

/** A row as the API returns it: status and metrics, never the intent or the DAG. */
export function toCompilation(row: CompilationRow): Compilation {
  const errorClass = ErrorClassSchema.safeParse(row.errorClass);
  return {
    id: row.id,
    workflowId: row.workflowId,
    mode: row.mode === 'regenerate' ? 'regenerate' : 'create',
    baseDraftRevision: row.baseDraftRevision,
    status: row.status as Compilation['status'],
    model: row.model,
    calls: row.calls,
    repairs: row.repairs,
    tokensUsed: row.llmTokensUsed,
    costMicroUsd: row.costMicroUsd,
    nodeCount: row.nodeCount,
    hasFallback: row.hasFallback,
    errorClass: errorClass.success ? errorClass.data : null,
    errorCode: row.errorCode,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

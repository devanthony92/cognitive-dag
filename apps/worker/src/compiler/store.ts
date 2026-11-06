import { compilations, llmCalls, sql, type WithContext } from '@cognitive-dag/db';
import type { ErrorClass } from '@cognitive-dag/dag-schema';

export type StartResult = 'running' | 'finished' | 'missing';

/** How a compilation ended; the content (DAG, fallback) is never part of it. */
export interface Finish {
  status: 'succeeded' | 'failed';
  /** Calls and repairs of the attempt that produced the outcome; null keeps the call count. */
  calls: number | null;
  repairs: number;
  nodeCount: number | null;
  hasFallback: boolean;
  errorClass?: ErrorClass;
  errorCode?: string;
}

/** Moves the row of a compilation through its life cycle (`queued` -> `running` -> final). */
export interface CompilationStore {
  /** `queued` or `running` -> `running`. Idempotent across the attempts of the activity. */
  start(organizationId: string, compilationId: string): Promise<StartResult>;
  /** Writes the final state. Returns false when the row was already final (nothing changed). */
  finish(organizationId: string, compilationId: string, outcome: Finish): Promise<boolean>;
}

export function createCompilationStore(withContext: WithContext): CompilationStore {
  return {
    async start(organizationId, compilationId) {
      return withContext({ organizationId }, async (tx) => {
        const started = await tx
          .update(compilations)
          .set({ status: 'running', startedAt: sql`coalesce(${compilations.startedAt}, now())` })
          .where(
            sql`${compilations.id} = ${compilationId}
              AND ${compilations.status} IN ('queued', 'running')`,
          )
          .returning({ id: compilations.id });
        if (started.length > 0) return 'running';
        const existing = await tx
          .select({ id: compilations.id })
          .from(compilations)
          .where(sql`${compilations.id} = ${compilationId}`);
        return existing.length > 0 ? 'finished' : 'missing';
      });
    },

    async finish(organizationId, compilationId, outcome) {
      return withContext({ organizationId }, async (tx) => {
        // With no count of its own (the attempt never got an answer) the calls are those recorded.
        const calls =
          outcome.calls === null
            ? sql`LEAST(3, (SELECT count(*) FROM ${llmCalls} WHERE ${llmCalls.compilationId} = ${compilationId}))`
            : outcome.calls;
        const finished = await tx
          .update(compilations)
          .set({
            status: outcome.status,
            calls,
            repairs: outcome.repairs,
            nodeCount: outcome.nodeCount,
            hasFallback: outcome.hasFallback,
            errorClass: outcome.errorClass ?? null,
            errorCode: outcome.errorCode ?? null,
            finishedAt: sql`now()`,
            startedAt: sql`coalesce(${compilations.startedAt}, now())`,
          })
          .where(
            sql`${compilations.id} = ${compilationId}
              AND ${compilations.status} IN ('queued', 'running')`,
          )
          .returning({ id: compilations.id });
        return finished.length > 0;
      });
    },
  };
}

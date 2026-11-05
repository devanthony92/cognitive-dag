import { llmCalls, llmUsageDaily, sql, workflowRuns, type WithContext } from '@cognitive-dag/db';
import type { Logger } from '@cognitive-dag/logger';
import { LlmError } from '@cognitive-dag/llm';
import { NodeFailure } from '../resilience/attempts';

export interface BudgetLimits {
  /** `LLM_MAX_TOKENS_PER_RUN` */
  perRun: number;
  /** `LLM_MAX_TOKENS_PER_ORG_DAY` */
  perOrganizationDay: number;
}

export interface Reservation {
  tokens: number;
  /** UTC day the daily counter was charged: the settlement adjusts that same row. */
  usageDate: string;
}

export interface CallRecord {
  organizationId: string;
  runId: string;
  nodeId: string;
  nodeType: 'llm.classify' | 'llm.extract' | 'llm.generate';
  attempt: number;
  repairs: number;
  model: string;
  /** Sum of the reservations of the attempt. */
  reservedTokens: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  outcome: 'succeeded' | 'invalid_output' | 'failed';
  errorCode?: string;
  durationMs: number;
}

export interface Budget {
  /**
   * Charges the run and the organization day before a call (research R4), in one transaction:
   * either both counters grow or neither does. Throws `LlmError` `budget_exhausted` when a limit
   * would be exceeded and a transient `NodeFailure` when PostgreSQL is not available (no call).
   */
  reserve(input: { organizationId: string; runId: string; tokens: number }): Promise<Reservation>;
  /**
   * After the call, in another transaction: moves both counters by `actual - reserved` (it may be
   * negative), adds the estimated cost and inserts the `llm_calls` row.
   */
  settle(call: CallRecord, reservations: readonly Reservation[]): Promise<void>;
}

export interface BudgetOptions {
  withContext: WithContext;
  limits: BudgetLimits;
  logger: Logger;
  now?: () => Date;
}

/** Thrown inside the transaction so it rolls back the run counter when the day is exhausted. */
class Exhausted extends Error {
  constructor(readonly kind: 'run' | 'daily') {
    super(kind);
  }
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

export function createBudget(options: BudgetOptions): Budget {
  const { withContext, limits, logger } = options;
  const now = options.now ?? (() => new Date());

  /**
   * Security event `llm.budget_exhausted` (ADR-0038): who, which run and which budget; never the
   * text. The type of the fields is closed so nothing else can be attached.
   */
  const securityEvent = (organizationId: string, runId: string, budget: 'run' | 'daily'): void => {
    logger.warn(
      {
        securityEvent: true,
        event: 'llm.budget_exhausted',
        outcome: 'blocked',
        organizationId,
        runId,
        budget,
      },
      'llm.budget_exhausted',
    );
  };

  return {
    async reserve({ organizationId, runId, tokens }) {
      const usageDate = utcDay(now());
      try {
        await withContext({ organizationId }, async (tx) => {
          // A reservation larger than the whole limit can never fit; the upsert below would let a
          // first insert through because its WHERE only applies to the conflict branch.
          if (tokens > limits.perOrganizationDay) throw new Exhausted('daily');
          const run = await tx
            .update(workflowRuns)
            .set({ llmTokensUsed: sql`${workflowRuns.llmTokensUsed} + ${tokens}` })
            .where(
              sql`${workflowRuns.id} = ${runId}
                AND ${workflowRuns.llmTokensUsed} + ${tokens} <= ${limits.perRun}`,
            )
            .returning({ id: workflowRuns.id });
          if (run.length === 0) throw new Exhausted('run');
          const day = await tx
            .insert(llmUsageDaily)
            .values({ organizationId, usageDate, tokensUsed: tokens })
            .onConflictDoUpdate({
              target: [llmUsageDaily.organizationId, llmUsageDaily.usageDate],
              set: {
                tokensUsed: sql`${llmUsageDaily.tokensUsed} + ${tokens}`,
                updatedAt: sql`now()`,
              },
              setWhere: sql`${llmUsageDaily.tokensUsed} + ${tokens} <= ${limits.perOrganizationDay}`,
            })
            .returning({ tokens: llmUsageDaily.tokensUsed });
          if (day.length === 0) throw new Exhausted('daily');
        });
      } catch (error) {
        if (error instanceof Exhausted) {
          securityEvent(organizationId, runId, error.kind);
          throw new LlmError(
            error.kind === 'run' ? 'LLM_RUN_BUDGET_EXHAUSTED' : 'LLM_DAILY_BUDGET_EXHAUSTED',
            error.kind === 'run'
              ? 'La ejecución agotó su presupuesto de tokens.'
              : 'La organización agotó su presupuesto diario de tokens.',
          );
        }
        logger.warn({ err: error, runId }, 'The token budget store is not available');
        throw new NodeFailure({
          errorClass: 'transient',
          code: 'BUDGET_STORE_UNAVAILABLE',
          message: 'The token budget store is not available.',
        });
      }
      return { tokens, usageDate };
    },

    async settle(call, reservations) {
      const reserved = reservations.reduce((sum, r) => sum + r.tokens, 0);
      const actual = call.inputTokens + call.outputTokens;
      const delta = actual - reserved;
      const usageDate = reservations[0]?.usageDate ?? utcDay(now());
      await withContext({ organizationId: call.organizationId }, async (tx) => {
        await tx
          .update(workflowRuns)
          .set({ llmTokensUsed: sql`GREATEST(0, ${workflowRuns.llmTokensUsed} + ${delta})` })
          .where(sql`${workflowRuns.id} = ${call.runId}`);
        await tx
          .update(llmUsageDaily)
          .set({
            tokensUsed: sql`GREATEST(0, ${llmUsageDaily.tokensUsed} + ${delta})`,
            costMicroUsd: sql`${llmUsageDaily.costMicroUsd} + ${call.costMicroUsd}`,
            updatedAt: sql`now()`,
          })
          .where(
            sql`${llmUsageDaily.organizationId} = ${call.organizationId}
              AND ${llmUsageDaily.usageDate} = ${usageDate}`,
          );
        await tx.insert(llmCalls).values({
          organizationId: call.organizationId,
          runId: call.runId,
          nodeId: call.nodeId,
          nodeType: call.nodeType,
          attempt: call.attempt,
          repairs: call.repairs,
          model: call.model,
          reservedTokens: reserved,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          costMicroUsd: call.costMicroUsd,
          outcome: call.outcome,
          errorCode: call.errorCode ?? null,
          durationMs: call.durationMs,
        });
      });
    },
  };
}

import { compilations, llmCalls, llmUsageDaily, sql, type WithContext } from '@cognitive-dag/db';
import { LlmError } from '@cognitive-dag/llm';
import type { Logger } from '@cognitive-dag/logger';
import { NodeFailure } from '../resilience/attempts';

export interface CompilerBudgetLimits {
  /** `LLM_MAX_TOKENS_PER_COMPILATION`: repairs and retries of the activity included. */
  perCompilation: number;
  /** `LLM_MAX_TOKENS_PER_ORG_DAY`: the same daily row the LLM nodes of F5 charge. */
  perOrganizationDay: number;
}

export interface CompilerReservation {
  tokens: number;
  /** UTC day the daily counter was charged: the settlement adjusts that same row. */
  usageDate: string;
}

/** What one call to the provider cost, to settle its reservation and record it. */
export interface CompilerCallRecord {
  organizationId: string;
  compilationId: string;
  /** Attempt of the Temporal activity. */
  attempt: number;
  /** Position of the call inside the attempt: 0 is the first answer, 1 and 2 are repairs. */
  repairs: number;
  model: string;
  reservedTokens: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  outcome: 'succeeded' | 'invalid_output' | 'failed';
  errorCode?: string;
  durationMs: number;
}

export interface CompilerBudget {
  /**
   * Charges the compilation and the organization day before a call (research R4), in one
   * transaction: either both counters grow or neither does. Throws `CompilerBudgetError` when the
   * cap of the compilation would be exceeded, `LlmError` `LLM_DAILY_BUDGET_EXHAUSTED` when the
   * day would, and a transient `NodeFailure` when PostgreSQL is not available (no call).
   */
  reserve(input: {
    organizationId: string;
    compilationId: string;
    tokens: number;
  }): Promise<CompilerReservation>;
  /**
   * After the call, in another transaction: moves both counters by `actual - reserved` (it may be
   * negative), adds the estimated cost and inserts the `llm_calls` row of the call.
   */
  settle(call: CompilerCallRecord, reservation: CompilerReservation): Promise<void>;
}

/**
 * The compilation used its own cap. It is an `LlmError` of the run-budget kind so the guard lets
 * it through untouched, and the activity reports it as `COMPILER_BUDGET_EXHAUSTED`.
 */
export class CompilerBudgetError extends LlmError {
  constructor() {
    super('LLM_RUN_BUDGET_EXHAUSTED', 'La compilación agotó su presupuesto de tokens.');
    this.name = 'CompilerBudgetError';
  }
}

export interface CompilerBudgetOptions {
  withContext: WithContext;
  limits: CompilerBudgetLimits;
  logger: Logger;
  now?: () => Date;
}

/** Thrown inside the transaction so it rolls back the compilation counter when the day is spent. */
class Exhausted extends Error {
  constructor(readonly kind: 'compilation' | 'daily') {
    super(kind);
  }
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

export function createCompilerBudget(options: CompilerBudgetOptions): CompilerBudget {
  const { withContext, limits, logger } = options;
  const now = options.now ?? (() => new Date());

  /**
   * Security event `llm.budget_exhausted` (ADR-0038): who, which compilation and which budget;
   * never the intent. The type of the fields is closed so nothing else can be attached.
   */
  const securityEvent = (
    organizationId: string,
    compilationId: string,
    budget: 'compilation' | 'daily',
  ): void => {
    logger.warn(
      {
        securityEvent: true,
        event: 'llm.budget_exhausted',
        outcome: 'blocked',
        organizationId,
        compilationId,
        budget,
      },
      'llm.budget_exhausted',
    );
  };

  return {
    async reserve({ organizationId, compilationId, tokens }) {
      const usageDate = utcDay(now());
      try {
        await withContext({ organizationId }, async (tx) => {
          // A reservation larger than the whole limit can never fit; the upsert below would let a
          // first insert through because its WHERE only applies to the conflict branch.
          if (tokens > limits.perOrganizationDay) throw new Exhausted('daily');
          const compilation = await tx
            .update(compilations)
            .set({ llmTokensUsed: sql`${compilations.llmTokensUsed} + ${tokens}` })
            .where(
              sql`${compilations.id} = ${compilationId}
                AND ${compilations.llmTokensUsed} + ${tokens} <= ${limits.perCompilation}`,
            )
            .returning({ id: compilations.id });
          if (compilation.length === 0) throw new Exhausted('compilation');
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
          securityEvent(organizationId, compilationId, error.kind);
          if (error.kind === 'compilation') throw new CompilerBudgetError();
          throw new LlmError(
            'LLM_DAILY_BUDGET_EXHAUSTED',
            'La organización agotó su presupuesto diario de tokens.',
          );
        }
        logger.warn({ err: error, compilationId }, 'The token budget store is not available');
        throw new NodeFailure({
          errorClass: 'transient',
          code: 'BUDGET_STORE_UNAVAILABLE',
          message: 'The token budget store is not available.',
        });
      }
      return { tokens, usageDate };
    },

    async settle(call, reservation) {
      const delta = call.inputTokens + call.outputTokens - reservation.tokens;
      await withContext({ organizationId: call.organizationId }, async (tx) => {
        await tx
          .update(compilations)
          .set({
            llmTokensUsed: sql`GREATEST(0, ${compilations.llmTokensUsed} + ${delta})`,
            costMicroUsd: sql`${compilations.costMicroUsd} + ${call.costMicroUsd}`,
          })
          .where(sql`${compilations.id} = ${call.compilationId}`);
        await tx
          .update(llmUsageDaily)
          .set({
            tokensUsed: sql`GREATEST(0, ${llmUsageDaily.tokensUsed} + ${delta})`,
            costMicroUsd: sql`${llmUsageDaily.costMicroUsd} + ${call.costMicroUsd}`,
            updatedAt: sql`now()`,
          })
          .where(
            sql`${llmUsageDaily.organizationId} = ${call.organizationId}
              AND ${llmUsageDaily.usageDate} = ${reservation.usageDate}`,
          );
        await tx.insert(llmCalls).values({
          organizationId: call.organizationId,
          compilationId: call.compilationId,
          nodeType: 'compiler',
          attempt: call.attempt,
          repairs: call.repairs,
          model: call.model,
          reservedTokens: reservation.tokens,
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

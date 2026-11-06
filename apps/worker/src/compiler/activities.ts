import { Context } from '@temporalio/activity';
import {
  COMPILER_MAX_OUTPUT_TOKENS,
  CompilerError,
  buildCompilerPrompt,
  compile,
  compilerCatalog,
  type CompiledDag,
} from '@cognitive-dag/compiler';
import type {
  CompilationResult,
  CompileIntentInput,
  CompileIntentResult,
} from '@cognitive-dag/contracts';
import { DEFAULT_LIMITS, type ErrorClass } from '@cognitive-dag/dag-schema';
import {
  LlmError,
  costMicroUsd,
  estimateReservation,
  newGuardTokens,
  translateProviderError,
  type LlmProvider,
  type LlmUsage,
  type Prices,
} from '@cognitive-dag/llm';
import type { Logger } from '@cognitive-dag/logger';
import { NodeFailure, toApplicationFailure } from '../resilience/attempts';
import type { ModelRateLimiter } from '../resilience/rate-limiter';
import {
  CompilerBudgetError,
  type CompilerBudget,
  type CompilerCallRecord,
  type CompilerReservation,
} from './budget';
import type { CompilationStore } from './store';

/** What `failCompilationActivity` records when the attempts of the compilation ran out. */
export interface FailCompilationInput {
  organizationId: string;
  compilationId: string;
  correlationId: string;
  errorCode: string;
  errorClass: ErrorClass;
}

export interface CompilerActivities {
  compileIntentActivity: (input: CompileIntentInput) => Promise<CompileIntentResult>;
  failCompilationActivity: (input: FailCompilationInput) => Promise<void>;
}

export interface CompilerActivityOptions {
  logger: Logger;
  provider: LlmProvider;
  budget: CompilerBudget;
  store: CompilationStore;
  /** `LLM_ENABLED`: false makes the compilation fail `LLM_DISABLED` without calling anything. */
  enabled: boolean;
  /** `LLM_MODEL_COMPILER` */
  model: string;
  prices: Prices;
  /** Global bucket by model (F5, research R14): the compiler shares the provider quota. */
  modelRateLimiter?: ModelRateLimiter;
}

/** Room a repair turn adds to the prompt besides the previous answer: codes and positions. */
const REPAIR_OVERHEAD_TOKENS = 512;

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

interface Failure {
  errorClass: ErrorClass;
  code: string;
  message: string;
  retryAfterMs?: number;
}

const isRetryable = (failure: Failure): boolean =>
  failure.errorClass === 'transient' || failure.errorClass === 'rate_limited';

/** Puts any error into the taxonomy. Messages are fixed text: they never carry the intent. */
function failureOf(error: unknown, reserveFailure: NodeFailure | undefined): Failure {
  // PostgreSQL failed while reserving: the guard saw it as an unavailable provider.
  if (reserveFailure) {
    return {
      errorClass: reserveFailure.errorClass,
      code: reserveFailure.code,
      message: reserveFailure.message,
    };
  }
  if (error instanceof CompilerBudgetError) {
    return {
      errorClass: 'budget_exhausted',
      code: 'COMPILER_BUDGET_EXHAUSTED',
      message: error.message,
    };
  }
  if (error instanceof LlmError) {
    return {
      errorClass: error.errorClass,
      code: error.code,
      message: error.message,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  if (error instanceof CompilerError || error instanceof NodeFailure) {
    return { errorClass: error.errorClass, code: error.code, message: error.message };
  }
  return {
    errorClass: 'transient',
    code: 'COMPILER_UNEXPECTED',
    message: 'La compilación falló por un error inesperado.',
  };
}

/** A failed attempt of the compiler, with what the activity needs to classify and record it. */
class AttemptFailed extends Error {
  constructor(
    readonly original: unknown,
    readonly reserveFailure: NodeFailure | undefined,
    readonly answered: number,
  ) {
    super('The compilation attempt failed.');
    this.name = 'AttemptFailed';
  }
}

const resultOf = (kind: CompilationResult['kind'], dag: CompiledDag): CompilationResult => ({
  kind,
  title: dag.title,
  definition: dag.definition as unknown as Record<string, unknown>,
  validation: dag.validation,
  omittedSensitiveFields: dag.omittedSensitiveFields,
});

/**
 * The compiler (F6). One attempt: kill switch and global rate limit, then `compile()` of the
 * compiler package with a reservation of budget before every call, settled right after it (so
 * a repair reuses what the previous call did not use) and recorded as one `llm_calls` row per
 * call. Neither the intent nor the DAG reaches a log or a table (SC-005): they travel only as
 * the input and the value of the Temporal workflow. The nonce and the canary are generated here,
 * never in the workflow (research R8).
 *
 * A transient or limited failure is thrown for Temporal to retry; every other end, success
 * included, is written to the row of the compilation and returned as a value.
 */
export function createCompilerActivities(options: CompilerActivityOptions): CompilerActivities {
  const { store, budget, model } = options;

  const rateLimited = async (log: Logger): Promise<void> => {
    const limiter = options.modelRateLimiter;
    if (!limiter) return;
    let decision;
    try {
      decision = await limiter.acquire(model);
    } catch (error) {
      log.warn({ err: error }, 'The rate limit store is not available');
      throw new NodeFailure({
        errorClass: 'transient',
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'The rate limit store is not available.',
      });
    }
    if (!decision.granted) {
      log.info({ retryAfterMs: decision.retryAfterMs }, 'Waiting for the rate limit');
      throw new NodeFailure({
        errorClass: 'rate_limited',
        code: 'RATE_LIMIT_EXHAUSTED',
        message: 'La compilación espera su turno bajo el límite de solicitudes.',
        ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
      });
    }
  };

  /** Everything that touches the provider in one attempt, with its ledger of reservations. */
  async function attempt(input: CompileIntentInput, log: Logger): Promise<CompileIntentResult> {
    const attemptNumber = Context.current().info.attempt;
    const tokens = newGuardTokens();
    const intent = input.intent.trim();
    const prompt = buildCompilerPrompt(
      intent,
      compilerCatalog(input.allowedTypes),
      tokens,
      DEFAULT_LIMITS,
    );
    const firstEstimate = estimateReservation(
      prompt.system.length + prompt.user.length,
      COMPILER_MAX_OUTPUT_TOKENS,
    );

    /** The call in flight: its reservation waits for the answer, and then for its verdict. */
    let pending:
      | {
          call: number;
          reservation: CompilerReservation;
          usage?: LlmUsage;
          durationMs?: number;
          failure?: LlmError;
        }
      | undefined;
    let answered = 0;
    let lastOutputChars = 0;
    let reserveFailure: NodeFailure | undefined;
    const spent: LlmUsage = { inputTokens: 0, outputTokens: 0 };

    /** A settlement that fails leaves the reservation (fail closed); it never fails the work. */
    const settle = async (
      outcome: CompilerCallRecord['outcome'],
      errorCode?: string,
    ): Promise<void> => {
      const call = pending;
      pending = undefined;
      if (!call) return;
      const usage = call.usage ?? NO_USAGE;
      try {
        await budget.settle(
          {
            organizationId: input.organizationId,
            compilationId: input.compilationId,
            attempt: attemptNumber,
            repairs: call.call,
            model,
            reservedTokens: call.reservation.tokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costMicroUsd: costMicroUsd(
              options.prices,
              model,
              usage.inputTokens,
              usage.outputTokens,
            ),
            outcome,
            ...(errorCode ? { errorCode } : {}),
            durationMs: call.durationMs ?? 0,
          },
          call.reservation,
        );
      } catch (error) {
        log.warn({ err: error }, 'Could not settle the token budget');
      }
    };

    /** Takes note of what each call spent; the content of the answer is never kept. */
    const traced: LlmProvider = {
      async generate(request) {
        const startedAt = Date.now();
        try {
          const response = await options.provider.generate(request);
          answered += 1;
          lastOutputChars = response.text.length;
          spent.inputTokens += response.inputTokens;
          spent.outputTokens += response.outputTokens;
          if (pending) {
            pending.usage = {
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
            };
            pending.durationMs = Date.now() - startedAt;
          }
          return response;
        } catch (error) {
          if (pending) {
            pending.failure = translateProviderError(error);
            pending.durationMs = Date.now() - startedAt;
          }
          throw error;
        }
      },
    };

    const beforeCall = async (call: number): Promise<void> => {
      // The previous answer was refused by the validation: it is being repaired.
      await settle('invalid_output', 'LLM_INVALID_OUTPUT');
      const estimate =
        call === 0
          ? firstEstimate
          : firstEstimate + Math.ceil(lastOutputChars / 4) + REPAIR_OVERHEAD_TOKENS;
      let reservation: CompilerReservation;
      try {
        reservation = await budget.reserve({
          organizationId: input.organizationId,
          compilationId: input.compilationId,
          tokens: estimate,
        });
      } catch (error) {
        if (error instanceof NodeFailure) reserveFailure = error;
        throw error;
      }
      pending = { call, reservation };
    };

    try {
      const outcome = await compile({
        provider: traced,
        model,
        intent,
        allowedTypes: input.allowedTypes,
        tokens,
        beforeCall,
      });
      if (outcome.status === 'succeeded') {
        await settle('succeeded');
        const finished = await store.finish(input.organizationId, input.compilationId, {
          status: 'succeeded',
          calls: outcome.calls,
          repairs: outcome.repairs,
          nodeCount: outcome.nodeCount,
          hasFallback: false,
        });
        log.info(
          {
            status: 'succeeded',
            calls: outcome.calls,
            repairs: outcome.repairs,
            nodeCount: outcome.nodeCount,
            inputTokens: spent.inputTokens,
            outputTokens: spent.outputTokens,
            recorded: finished,
          },
          'Compilation finished',
        );
        return {
          status: 'succeeded',
          result: resultOf('result', outcome),
          errorCode: null,
          errorClass: null,
        };
      }
      await settle('invalid_output', outcome.errorCode);
      const nodeCount = outcome.fallback?.definition.nodes.length ?? null;
      await store.finish(input.organizationId, input.compilationId, {
        status: 'failed',
        calls: outcome.calls,
        repairs: outcome.repairs,
        nodeCount,
        hasFallback: outcome.fallback !== undefined,
        errorClass: outcome.errorClass,
        errorCode: outcome.errorCode,
      });
      log.warn(
        {
          status: 'failed',
          code: outcome.errorCode,
          calls: outcome.calls,
          repairs: outcome.repairs,
          nodeCount,
          inputTokens: spent.inputTokens,
          outputTokens: spent.outputTokens,
        },
        'Compilation finished',
      );
      return {
        status: 'failed',
        result: outcome.fallback ? resultOf('fallback', outcome.fallback) : null,
        errorCode: outcome.errorCode,
        errorClass: outcome.errorClass,
      };
    } catch (error) {
      // What the call in flight spent is settled before the failure leaves.
      const call = pending?.failure ?? (error instanceof LlmError ? error : undefined);
      await settle(
        call?.errorClass === 'invalid_output' ? 'invalid_output' : 'failed',
        call?.code ?? 'LLM_PROVIDER_UNAVAILABLE',
      );
      throw new AttemptFailed(error, reserveFailure, answered);
    }
  }

  return {
    async compileIntentActivity(input) {
      const log = options.logger.child({
        correlationId: input.correlationId,
        compilationId: input.compilationId,
      });
      const attemptNumber = Context.current().info.attempt;
      const started = await store.start(input.organizationId, input.compilationId);
      if (started !== 'running') {
        throw toApplicationFailure(
          new NodeFailure({
            errorClass: 'permanent',
            code: started === 'missing' ? 'COMPILATION_NOT_FOUND' : 'COMPILATION_ALREADY_FINISHED',
            message: 'La compilación no se puede ejecutar.',
          }),
          { attempt: attemptNumber, nonRetryable: true },
        );
      }

      let calls = 0;
      let failure: Failure;
      try {
        if (!options.enabled) {
          throw new NodeFailure({
            errorClass: 'permanent',
            code: 'LLM_DISABLED',
            message: 'Los nodos de IA están desactivados.',
          });
        }
        await rateLimited(log);
        return await attempt(input, log);
      } catch (error) {
        if (error instanceof AttemptFailed) {
          calls = Math.min(error.answered, 3);
          failure = failureOf(error.original, error.reserveFailure);
        } else {
          failure = failureOf(error, undefined);
        }
      }

      if (isRetryable(failure)) {
        log.warn({ attempt: attemptNumber, code: failure.code }, 'Compilation attempt failed');
        throw toApplicationFailure(
          new NodeFailure({
            errorClass: failure.errorClass,
            code: failure.code,
            message: failure.message,
            ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
          }),
          {
            attempt: attemptNumber,
            nonRetryable: false,
            ...(failure.retryAfterMs === undefined
              ? {}
              : { nextRetryDelayMs: failure.retryAfterMs }),
          },
        );
      }

      await store.finish(input.organizationId, input.compilationId, {
        status: 'failed',
        calls,
        repairs: Math.max(0, calls - 1),
        nodeCount: null,
        hasFallback: false,
        errorClass: failure.errorClass,
        errorCode: failure.code,
      });
      log.warn({ status: 'failed', code: failure.code, calls }, 'Compilation finished');
      return {
        status: 'failed',
        result: null,
        errorCode: failure.code,
        errorClass: failure.errorClass,
      };
    },

    async failCompilationActivity(input) {
      const log = options.logger.child({
        correlationId: input.correlationId,
        compilationId: input.compilationId,
      });
      const finished = await store.finish(input.organizationId, input.compilationId, {
        status: 'failed',
        calls: null,
        repairs: 0,
        nodeCount: null,
        hasFallback: false,
        errorClass: input.errorClass,
        errorCode: input.errorCode,
      });
      log.warn(
        { status: 'failed', code: input.errorCode, recorded: finished },
        'Compilation gave up',
      );
    },
  };
}

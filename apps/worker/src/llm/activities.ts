import { NODE_CATALOG, type FieldSpec } from '@cognitive-dag/dag-schema';
import {
  LlmError,
  buildPrompt,
  costMicroUsd,
  estimateReservation,
  maxOutputTokensFor,
  newGuardTokens,
  redactText,
  runGuarded,
  type LlmProvider,
  type OutputCapSpec,
  type Prices,
  type PromptSpec,
} from '@cognitive-dag/llm';
import type { Logger } from '@cognitive-dag/logger';
import { NodeFailure, runWithPolicy, type AttemptPolicy } from '../resilience/attempts';
import type { ModelRateLimiter, RateLimiter } from '../resilience/rate-limiter';
import type { Budget, CallRecord, Reservation } from './budget';

export type LlmNodeType = 'llm.classify' | 'llm.extract' | 'llm.generate';

/** Input of an LLM activity: the node config already has its `{{references}}` resolved. */
export interface LlmNodeInput {
  runId: string;
  nodeId: string;
  correlationId: string;
  organizationId: string;
  /** Effective policy of the node (retries are counted here, as in F4). */
  policy: AttemptPolicy;
  config: Record<string, unknown>;
}

export interface LlmNodeResult {
  output: unknown;
  /** Attempt of the activity that produced the result, for the step record. */
  attempts: number;
}

export interface LlmActivities {
  llmClassify: (input: LlmNodeInput) => Promise<LlmNodeResult>;
  llmExtract: (input: LlmNodeInput) => Promise<LlmNodeResult>;
  llmGenerate: (input: LlmNodeInput) => Promise<LlmNodeResult>;
}

export interface LlmActivityOptions {
  logger: Logger;
  provider: LlmProvider;
  budget: Budget;
  /** `LLM_ENABLED`: false makes every activity fail `LLM_DISABLED` without calling anything. */
  enabled: boolean;
  models: Readonly<Record<LlmNodeType, string>>;
  prices: Prices;
  maxInputChars: number;
  /** Bucket by organization and node type (F4). */
  rateLimiter?: RateLimiter;
  /** Global bucket by model (F5, research R14). */
  modelRateLimiter?: ModelRateLimiter;
}

const permanent = (code: string, message: string): NodeFailure =>
  new NodeFailure({ errorClass: 'permanent', code, message });

function asNodeFailure(error: unknown): NodeFailure {
  if (error instanceof NodeFailure) return error;
  if (error instanceof LlmError) {
    return new NodeFailure({
      errorClass: error.errorClass,
      code: error.code,
      message: error.message,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    });
  }
  return new NodeFailure({
    errorClass: 'transient',
    message: 'The node failed with an unexpected error.',
  });
}

interface NodePlan {
  /** Text the user wrote, with references resolved. */
  text: string;
  redactPii: boolean;
  prompt: PromptSpec;
  cap: OutputCapSpec;
  /** Extra rule the schema cannot say. */
  check?: (value: unknown) => readonly string[];
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function planFor(type: LlmNodeType, config: Record<string, unknown>): NodePlan {
  const redact = config['redactPii'] === true;
  switch (type) {
    case 'llm.classify':
      return {
        text: textOf(config['text']),
        redactPii: redact,
        prompt: { kind: 'classify', labels: config['labels'] as string[] },
        cap: { kind: 'classify' },
      };
    case 'llm.extract': {
      const fields = config['fields'] as FieldSpec[];
      return {
        text: textOf(config['text']),
        redactPii: redact,
        prompt: { kind: 'extract', fields },
        cap: { kind: 'extract', fieldCount: fields.length },
      };
    }
    case 'llm.generate': {
      const maxLength = Number(config['maxLength']);
      return {
        text: textOf(config['instruction']),
        redactPii: redact,
        prompt: { kind: 'generate', language: String(config['language']), maxLength },
        cap: { kind: 'generate', maxLength },
        check: (value) =>
          textOf((value as { text?: unknown }).text).length > maxLength
            ? ['text: longer than the allowed length']
            : [],
      };
    }
  }
}

/**
 * The LLM nodes (F5). One attempt: checks the input, takes the rate limit tokens, reserves
 * budget, calls the model through the guard (with its repairs), settles the budget and records
 * the call. Neither the text nor the answer reaches a log, an event or a table (SC-004). The
 * nonce and the canary are generated here, never in the workflow (research R8).
 */
export function createLlmActivities(options: LlmActivityOptions): LlmActivities {
  const run =
    (type: LlmNodeType) =>
    (input: LlmNodeInput): Promise<LlmNodeResult> => {
      const log = options.logger.child({
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      const model = options.models[type];
      const plan = planFor(type, input.config);

      const rateLimited = async (
        acquire: () => Promise<{ granted: boolean; retryAfterMs?: number }>,
      ): Promise<void> => {
        let decision;
        try {
          decision = await acquire();
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
            message: 'The node is waiting for its turn under the rate limit.',
            ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
          });
        }
      };

      /** Before anything is spent: kill switch, input checks and the rate limits (research R14). */
      const gate = async (): Promise<void> => {
        if (!options.enabled) {
          throw permanent('LLM_DISABLED', 'Los nodos de IA están desactivados.');
        }
        if (plan.text.trim() === '') {
          throw permanent('LLM_EMPTY_INPUT', 'El texto del nodo está vacío.');
        }
        if (plan.text.length > options.maxInputChars) {
          throw permanent('LLM_INPUT_TOO_LARGE', 'El texto del nodo supera el máximo permitido.');
        }
        const { rateLimiter, modelRateLimiter } = options;
        if (rateLimiter) await rateLimited(() => rateLimiter.acquire(input.organizationId, type));
        if (modelRateLimiter) await rateLimited(() => modelRateLimiter.acquire(model));
      };

      const body = async (attempt: number): Promise<LlmNodeResult> => {
        const startedAt = Date.now();
        const tokens = newGuardTokens();
        const text = plan.redactPii ? redactText(plan.text).text : plan.text;
        const prompt = buildPrompt(plan.prompt, text, tokens);
        const maxOutputTokens = maxOutputTokensFor(plan.cap);
        const estimate = estimateReservation(
          prompt.system.length + prompt.user.length,
          maxOutputTokens,
        );
        const outputType = NODE_CATALOG[type].outputSchema(input.config);
        if (!outputType) throw permanent('LLM_PROVIDER_REJECTED', 'The node has no output type.');

        const reservations: Reservation[] = [];
        let reserveFailure: NodeFailure | undefined;
        const record = (
          usage: { inputTokens: number; outputTokens: number },
          repairs: number,
          failure?: LlmError,
        ): CallRecord => ({
          organizationId: input.organizationId,
          runId: input.runId,
          nodeId: input.nodeId,
          nodeType: type,
          attempt,
          repairs,
          model,
          reservedTokens: reservations.reduce((sum, r) => sum + r.tokens, 0),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costMicroUsd: costMicroUsd(options.prices, model, usage.inputTokens, usage.outputTokens),
          outcome: !failure
            ? 'succeeded'
            : failure.errorClass === 'invalid_output'
              ? 'invalid_output'
              : 'failed',
          ...(failure ? { errorCode: failure.code } : {}),
          durationMs: Date.now() - startedAt,
        });
        /** A settlement that fails leaves the reservation (fail closed); it never fails the node. */
        const settle = async (call: CallRecord): Promise<void> => {
          if (reservations.length === 0) return;
          try {
            await options.budget.settle(call, reservations);
          } catch (error) {
            log.warn({ err: error }, 'Could not settle the token budget');
          }
        };

        try {
          const result = await runGuarded({
            provider: options.provider,
            model,
            system: prompt.system,
            user: prompt.user,
            outputType,
            maxOutputTokens,
            canary: tokens.canary,
            ...(plan.check ? { check: plan.check } : {}),
            beforeCall: async () => {
              try {
                reservations.push(
                  await options.budget.reserve({
                    organizationId: input.organizationId,
                    runId: input.runId,
                    tokens: estimate,
                  }),
                );
              } catch (error) {
                if (error instanceof NodeFailure) reserveFailure = error;
                throw error;
              }
            },
          });
          await settle(record(result, result.repairs));
          log.info(
            {
              attempt,
              model,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              repairs: result.repairs,
            },
            'LLM node finished',
          );
          return { output: result.value, attempts: attempt };
        } catch (error) {
          if (reserveFailure) {
            // PostgreSQL failed while reserving: no call was made. A reservation of an earlier call
            // of this attempt (a repair) is still settled with what was spent.
            const spent = error instanceof LlmError ? error : undefined;
            await settle(
              record(
                spent?.usage ?? { inputTokens: 0, outputTokens: 0 },
                spent?.repairs ?? 0,
                new LlmError('LLM_PROVIDER_UNAVAILABLE', ''),
              ),
            );
            throw reserveFailure;
          }
          const failure =
            error instanceof LlmError ? error : new LlmError('LLM_PROVIDER_UNAVAILABLE', '');
          await settle(
            record(
              failure.usage ?? { inputTokens: 0, outputTokens: 0 },
              failure.repairs ?? 0,
              failure,
            ),
          );
          log.warn({ attempt, model, code: failure.code }, 'LLM node failed');
          throw asNodeFailure(failure);
        }
      };

      return runWithPolicy({
        policy: input.policy,
        gate,
        body: ({ executed }) => body(executed),
      });
    };

  return {
    llmClassify: run('llm.classify'),
    llmExtract: run('llm.extract'),
    llmGenerate: run('llm.generate'),
  };
}

import { z } from 'zod';
import { modelsWithoutPrice, parsePrices, type Prices } from '@cognitive-dag/llm';
import {
  LLM_MODEL_RATE_LIMIT_VARIABLE,
  parseBucketConfig,
  parseRateLimits,
  type BucketConfig,
  type RateLimits,
} from '../resilience/rate-limit-config';

const positiveInt = (fallback: number, max = 1_000_000_000) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TEMPORAL_ADDRESS: z.string().regex(/^[\w.-]+:\d+$/),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1),
  // The worker writes run records as app_runtime (never as the migrator) and publishes live events.
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  VALKEY_URL: z.string().regex(/^rediss?:\/\//),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PING_ACTIVITY_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(0),

  // --- LLM nodes (F5). Values are never logged: GEMINI_API_KEY is a secret. ---
  LLM_PROVIDER: z.enum(['fake', 'gemini']).default('fake'),
  GEMINI_API_KEY: z.string().optional(),
  // Kill switch: false makes every LLM activity fail `LLM_DISABLED` without calling the provider.
  LLM_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  LLM_MODEL_CLASSIFY: z.string().min(1).max(64).default('gemini-3.5-flash-lite'),
  LLM_MODEL_EXTRACT: z.string().min(1).max(64).default('gemini-3.5-flash-lite'),
  LLM_MODEL_GENERATE: z.string().min(1).max(64).default('gemini-3.5-flash-lite'),
  // Model of the NL → DAG compiler (F6, research R5, O6).
  LLM_MODEL_COMPILER: z.string().min(1).max(64).default('gemini-3.5-flash-lite'),
  // `<model>:<input>:<output>;...` in micro-USD per million tokens. Parsed apart.
  LLM_PRICES: z.string().optional(),
  LLM_MAX_TOKENS_PER_RUN: positiveInt(50_000),
  // Token cap of one compilation, repairs included (F6, research R4).
  LLM_MAX_TOKENS_PER_COMPILATION: positiveInt(30_000),
  LLM_MAX_TOKENS_PER_ORG_DAY: positiveInt(500_000),
  LLM_MAX_INPUT_CHARS: positiveInt(20_000),
  TEMPORAL_LLM_TASK_QUEUE: z.string().min(1).default('cognitive-dag-llm'),
  LLM_MAX_CONCURRENT_ACTIVITIES: positiveInt(4, 100),
  // Global token bucket per model (provider quota); parsed apart.
  RATE_LIMIT_LLM_MODEL: z.string().optional(),
});

/** Global per-model bucket when the variable is not set (research R14). */
const DEFAULT_LLM_MODEL_RATE_LIMIT: BucketConfig = { capacity: 15, refillPerSecond: 0.25 };

export type WorkerConfig = z.infer<typeof EnvSchema> & {
  /** Token bucket by node type, from `RATE_LIMIT_<NODE_TYPE>`. */
  rateLimits: RateLimits;
  /** Model of each LLM node type. */
  llmModels: Readonly<Record<'llm.classify' | 'llm.extract' | 'llm.generate', string>>;
  /** Prices by model, in micro-USD per million tokens. */
  llmPrices: Prices;
  /** Configured models without a price: their cost is 0 and the worker warns at startup. */
  llmModelsWithoutPrice: string[];
  /** Token bucket shared by every organization, per model (`rl:global:<model>`). */
  llmModelRateLimit: BucketConfig;
};

export class InvalidConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidConfigError';
  }
}

/** Validates the environment and names offending variables only, never their values. */
export function parseEnv(env: NodeJS.ProcessEnv): WorkerConfig {
  const result = EnvSchema.safeParse(env);
  const rateLimits = parseRateLimits(env);
  const prices = parsePrices(env.LLM_PRICES);
  const modelLimitValue = env.RATE_LIMIT_LLM_MODEL?.trim();
  const modelLimit =
    modelLimitValue === undefined || modelLimitValue === ''
      ? DEFAULT_LLM_MODEL_RATE_LIMIT
      : parseBucketConfig(modelLimitValue);
  const invalid = new Set(rateLimits.invalid);
  if (prices.invalid) invalid.add('LLM_PRICES');
  if (modelLimit === undefined) invalid.add(LLM_MODEL_RATE_LIMIT_VARIABLE);
  if (result.success && result.data.LLM_PROVIDER === 'gemini' && !result.data.GEMINI_API_KEY) {
    invalid.add('GEMINI_API_KEY');
  }
  if (!result.success) {
    for (const issue of result.error.issues) invalid.add(String(issue.path[0]));
  }
  if (!result.success || invalid.size > 0 || modelLimit === undefined) {
    throw new InvalidConfigError([...invalid].sort());
  }
  const data = result.data;
  const llmModels = {
    'llm.classify': data.LLM_MODEL_CLASSIFY,
    'llm.extract': data.LLM_MODEL_EXTRACT,
    'llm.generate': data.LLM_MODEL_GENERATE,
  } as const;
  return {
    ...data,
    GEMINI_API_KEY: data.GEMINI_API_KEY === '' ? undefined : data.GEMINI_API_KEY,
    rateLimits: rateLimits.limits,
    llmModels,
    llmPrices: prices.prices,
    llmModelsWithoutPrice: modelsWithoutPrice(
      [...Object.values(llmModels), data.LLM_MODEL_COMPILER],
      prices.prices,
    ),
    llmModelRateLimit: modelLimit,
  };
}

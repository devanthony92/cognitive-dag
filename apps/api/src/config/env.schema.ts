import { z } from 'zod';
import { DEFAULT_LLM_TASK_QUEUE } from '@cognitive-dag/contracts';
import { ABSOLUTE_LIMITS } from '@cognitive-dag/dag-schema';

/** A ceiling can only lower the absolute maximum of the platform (research R12). */
const ceiling = (absolute: number, minimum: number) =>
  z.coerce.number().int().min(minimum).max(absolute).default(absolute);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.url(),
  BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/)
    .default('100kb'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
  TEMPORAL_ADDRESS: z.string().regex(/^[\w.-]+:\d+$/),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1),
  // Queue of the LLM activities (F5, R6): the API hands it to the workflow, which cannot read the env.
  TEMPORAL_LLM_TASK_QUEUE: z.string().min(1).max(255).default(DEFAULT_LLM_TASK_QUEUE),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().min(3).default('CognitiveDAG <no-reply@cognitive-dag.localhost>'),
  // Origin of the web app: base of the links inside emails. Defaults to WEB_ORIGIN.
  APP_BASE_URL: z.url().optional(),
  // Ceilings for the DAG limits of every organization (FR-020); they cannot exceed the platform maximum.
  DAG_MAX_NODES_CEILING: ceiling(ABSOLUTE_LIMITS.maxNodes, 1),
  DAG_MAX_EDGES_CEILING: ceiling(ABSOLUTE_LIMITS.maxEdges, 0),
  DAG_MAX_DEFINITION_BYTES_CEILING: ceiling(ABSOLUTE_LIMITS.maxDefinitionBytes, 1024),
  // Interval of the comment that keeps a live run stream open through proxies (F3, R4).
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(50).max(60_000).default(15_000),
  // Daily token limit per organization (F5, research R4): the worker enforces it, the API shows it.
  LLM_MAX_TOKENS_PER_ORG_DAY: z.coerce.number().int().min(1).max(1_000_000_000).default(500_000),
  // Compilations per person per hour and per organization per UTC day (F6, research R13).
  COMPILER_MAX_PER_USER_HOUR: z.coerce.number().int().min(1).max(10_000).default(10),
  COMPILER_MAX_PER_ORG_DAY: z.coerce.number().int().min(1).max(100_000).default(50),
  // Model recorded on each compilation; the worker reads the same variable to call it (F6, R5).
  LLM_MODEL_COMPILER: z.string().min(1).max(64).default('gemini-3.5-flash-lite'),
  // Parsed by FlagsModule: an invalid value must disable flags, not stop the API.
  FEATURE_FLAGS: z.string().default('{}'),
});

/** Shape of FEATURE_FLAGS: flag key to boolean value. */
export const FeatureFlagsSchema = z.record(z.string().min(1), z.boolean());

export type AppConfig = z.infer<typeof EnvSchema>;

export class InvalidConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Validates the environment. On failure the error names the offending variables only:
 * values are never included because they may hold credentials.
 */
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new InvalidConfigError(variables.sort());
  }
  return result.data;
}

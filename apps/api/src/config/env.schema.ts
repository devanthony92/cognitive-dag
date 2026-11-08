import { z } from 'zod';
import { parseMasterKey } from '@cognitive-dag/connectors';
import {
  DEFAULT_HTTP_TASK_QUEUE,
  DEFAULT_LLM_TASK_QUEUE,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  DEFAULT_WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
} from '@cognitive-dag/contracts';
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
  // Queue of the HTTP activities (F7, R12): handed to the workflow like the LLM one.
  TEMPORAL_HTTP_TASK_QUEUE: z.string().min(1).max(255).default(DEFAULT_HTTP_TASK_QUEUE),
  // Master key of the envelope encryption of credentials (F7, R10): base64 of 32 bytes. Optional
  // outside production; without it the credential endpoints answer CREDENTIALS_NOT_CONFIGURED.
  CREDENTIALS_MASTER_KEY: z.string().optional(),
  // Public webhook (F7, R3): body cap and half-width of the accepted timestamp window.
  WEBHOOK_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_485_760)
    .default(DEFAULT_WEBHOOK_MAX_BODY_BYTES),
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .default(DEFAULT_WEBHOOK_TIMESTAMP_WINDOW_SECONDS),
  // Public origin of this API, base of the webhook URLs the UI shows (F7). Without it the URL is
  // built for localhost, which is right only for development.
  API_PUBLIC_URL: z.url().optional(),
  // Parsed by FlagsModule: an invalid value must disable flags, not stop the API.
  FEATURE_FLAGS: z.string().default('{}'),
});

/** Shape of FEATURE_FLAGS: flag key to boolean value. */
export const FeatureFlagsSchema = z.record(z.string().min(1), z.boolean());

export type AppConfig = z.infer<typeof EnvSchema> & {
  /** `CREDENTIALS_MASTER_KEY` decoded; absent when the variable is not set (never in production). */
  credentialsMasterKey: Buffer | undefined;
};

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
  const invalid = new Set<string>();
  if (!result.success) {
    for (const issue of result.error.issues) invalid.add(String(issue.path[0]));
  }
  const masterKeyText = env.CREDENTIALS_MASTER_KEY === '' ? undefined : env.CREDENTIALS_MASTER_KEY;
  let credentialsMasterKey: Buffer | undefined;
  if (masterKeyText !== undefined) {
    try {
      credentialsMasterKey = parseMasterKey(masterKeyText);
    } catch {
      invalid.add('CREDENTIALS_MASTER_KEY');
    }
  } else if (env.NODE_ENV === 'production') {
    invalid.add('CREDENTIALS_MASTER_KEY');
  }
  if (!result.success || invalid.size > 0) throw new InvalidConfigError([...invalid].sort());
  // The raw key stays out of the config object: only the decoded buffer travels.
  return { ...result.data, CREDENTIALS_MASTER_KEY: undefined, credentialsMasterKey };
}

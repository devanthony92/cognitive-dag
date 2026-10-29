import { z } from 'zod';

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
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().min(3).default('CognitiveDAG <no-reply@cognitive-dag.localhost>'),
  // Origin of the web app: base of the links inside emails. Defaults to WEB_ORIGIN.
  APP_BASE_URL: z.url().optional(),
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

import { z } from 'zod';

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
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

export class InvalidConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'InvalidConfigError';
  }
}

/** Validates the environment and names offending variables only, never their values. */
export function parseEnv(env: NodeJS.ProcessEnv): WorkerConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new InvalidConfigError(variables.sort());
  }
  return result.data;
}

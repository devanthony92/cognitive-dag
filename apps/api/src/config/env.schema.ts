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
});

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

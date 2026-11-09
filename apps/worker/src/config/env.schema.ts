import { z } from 'zod';
import { parseMasterKey } from '@cognitive-dag/connectors';
import { DEFAULT_HTTP_TASK_QUEUE } from '@cognitive-dag/contracts';
import { modelsWithoutPrice, parsePrices, type Prices } from '@cognitive-dag/llm';
import {
  LLM_MODEL_RATE_LIMIT_VARIABLE,
  parseBucketConfig,
  parseRateLimits,
  type BucketConfig,
  type RateLimits,
} from '../resilience/rate-limit-config';
import { buildTemporalTls, type TemporalTls } from '../temporal/temporal-tls';
import {
  InvalidConfigError,
  isDevelopmentPassword,
  readSecretFile,
  readTextFile,
  requiresVerifiedTls,
  valueOf,
  type FileReader,
  type SmtpAuth,
  type ValkeyAuth,
} from './secrets';

export { InvalidConfigError } from './secrets';

const TEMPORAL_TLS_VARIABLES = [
  'TEMPORAL_TLS_CA_FILE',
  'TEMPORAL_TLS_CERT_FILE',
  'TEMPORAL_TLS_KEY_FILE',
];

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

  // --- Triggers, human control and HTTP (F7). Secrets are never logged. ---
  // Master key of the envelope encryption of credentials: base64 of 32 bytes. Optional outside
  // production (an `http.request` with a credential then fails `CREDENTIALS_NOT_CONFIGURED`).
  CREDENTIALS_MASTER_KEY: z.string().optional(),
  // Kill switches: false makes the schedule launcher skip firings, or the HTTP activities fail
  // `HTTP_DISABLED` without calling the destination.
  TRIGGERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  HTTP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  TEMPORAL_HTTP_TASK_QUEUE: z.string().min(1).max(255).default(DEFAULT_HTTP_TASK_QUEUE),
  HTTP_MAX_CONCURRENT_ACTIVITIES: positiveInt(20, 100),
  // Circuit breaker per organization and host (research R12).
  HTTP_CB_FAILURES: positiveInt(5, 1000),
  HTTP_CB_WINDOW_SECONDS: positiveInt(60, 3600),
  HTTP_CB_COOLDOWN_SECONDS: positiveInt(30, 3600),
  HTTP_CB_MAX_WAIT_SECONDS: positiveInt(120, 3600),
  // How late a missed schedule firing may still run (research R6).
  SCHEDULE_CATCHUP_WINDOW_SECONDS: positiveInt(3600, 86_400),
  // The data model caps `approvals.notified_count` at 20.
  APPROVAL_EMAIL_MAX_RECIPIENTS: positiveInt(20, 20),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().min(3).default('CognitiveDAG <no-reply@cognitive-dag.localhost>'),
  // TLS of the SMTP connection (F9, FR-030): `true` implicit TLS, `starttls` required upgrade and
  // `false` plain text, which production refuses (Mailpit in development).
  SMTP_SECURE: z.enum(['true', 'false', 'starttls']).default('false'),
  // Origin of the web app: base of the links inside the approval emails.
  APP_BASE_URL: z.url().optional(),
  // Tests only (research R9.10): lets the HTTP client reach loopback. Must not exist in production.
  HTTP_TEST_ALLOW_LOOPBACK: z
    .enum(['true', 'false', ''])
    .default('false')
    .transform((value) => value === 'true'),
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
  /** `CREDENTIALS_MASTER_KEY` decoded; absent when the variable is not set (never in production). */
  credentialsMasterKey: Buffer | undefined;
  /** User, password and CA of Valkey, read from their files; absent in development. */
  valkeyAuth: ValkeyAuth | undefined;
  /** SMTP user and password, read from their files; absent with Mailpit. */
  smtpAuth: SmtpAuth | undefined;
  /** mTLS options of the Temporal connections; absent in development. */
  temporalTls: TemporalTls | undefined;
};

/**
 * Validates the environment and names offending variables only, never their values. Secrets arrive
 * as files (`<NAME>_FILE`); `read` is injectable for tests. With `NODE_ENV=production` the startup
 * rules of FR-012 apply (specs/010-deployment/contracts/production-env.md).
 */
export function parseEnv(env: NodeJS.ProcessEnv, read: FileReader = readTextFile): WorkerConfig {
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
  if (!result.success) {
    for (const issue of result.error.issues) invalid.add(String(issue.path[0]));
  }
  const production = env.NODE_ENV === 'production';
  const secret = (name: string) => readSecretFile(env, name, read, invalid);

  // The Gemini key: a file in production, where the direct variable is not allowed.
  const geminiFile = secret('GEMINI_API_KEY_FILE');
  const geminiDirect = valueOf(env, 'GEMINI_API_KEY');
  const geminiKey = geminiFile ?? geminiDirect;
  if (production && geminiDirect !== undefined) invalid.add('GEMINI_API_KEY');
  if (result.success && result.data.LLM_PROVIDER === 'gemini' && geminiKey === undefined) {
    invalid.add(production ? 'GEMINI_API_KEY_FILE' : 'GEMINI_API_KEY');
  }

  // The master key: a file in production, where the direct variable is not allowed.
  const masterKeyFile = secret('CREDENTIALS_MASTER_KEY_FILE');
  const masterKeyDirect = valueOf(env, 'CREDENTIALS_MASTER_KEY');
  const masterKeyText = masterKeyFile ?? masterKeyDirect;
  let credentialsMasterKey: Buffer | undefined;
  if (masterKeyText !== undefined) {
    try {
      credentialsMasterKey = parseMasterKey(masterKeyText);
    } catch {
      invalid.add(
        masterKeyFile === undefined ? 'CREDENTIALS_MASTER_KEY' : 'CREDENTIALS_MASTER_KEY_FILE',
      );
    }
  }
  if (production && (masterKeyDirect !== undefined || masterKeyText === undefined)) {
    invalid.add('CREDENTIALS_MASTER_KEY');
  }

  // PostgreSQL: the password comes from its file and joins the URL here, never in the repository.
  const databasePassword = secret('DATABASE_PASSWORD_FILE');
  let databaseUrl = valueOf(env, 'DATABASE_URL');
  if (databaseUrl !== undefined && URL.canParse(databaseUrl)) {
    const url = new URL(databaseUrl);
    if (production) {
      if (!requiresVerifiedTls(url)) invalid.add('DATABASE_URL');
      if (url.password !== '' && isDevelopmentPassword(decodeURIComponent(url.password))) {
        invalid.add('DATABASE_URL');
      }
    }
    if (databasePassword !== undefined) {
      url.password = databasePassword;
      databaseUrl = url.toString();
    }
  }
  if (production && databasePassword !== undefined && isDevelopmentPassword(databasePassword)) {
    invalid.add('DATABASE_PASSWORD_FILE');
  }

  // Valkey: `rediss://`, an ACL user and the CA of the internal PKI.
  const valkeyPassword = secret('VALKEY_PASSWORD_FILE');
  const valkeyUsername = valueOf(env, 'VALKEY_USERNAME');
  const valkeyCa = secret('VALKEY_CA_FILE');
  if (production) {
    if (!(valueOf(env, 'VALKEY_URL') ?? '').startsWith('rediss://')) invalid.add('VALKEY_URL');
    if (valkeyUsername === undefined) invalid.add('VALKEY_USERNAME');
    if (valkeyPassword === undefined) invalid.add('VALKEY_PASSWORD_FILE');
    if (valueOf(env, 'VALKEY_CA_FILE') === undefined) invalid.add('VALKEY_CA_FILE');
    if (valkeyPassword !== undefined && isDevelopmentPassword(valkeyPassword)) {
      invalid.add('VALKEY_PASSWORD_FILE');
    }
  }
  const valkeyAuth: ValkeyAuth | undefined =
    valkeyUsername || valkeyPassword || valkeyCa
      ? {
          ...(valkeyUsername ? { username: valkeyUsername } : {}),
          ...(valkeyPassword ? { password: valkeyPassword } : {}),
          ...(valkeyCa ? { ca: valkeyCa } : {}),
        }
      : undefined;

  // Temporal: mTLS with the internal PKI.
  let temporalTls: TemporalTls | undefined;
  try {
    temporalTls = buildTemporalTls(
      {
        caFile: valueOf(env, 'TEMPORAL_TLS_CA_FILE'),
        certFile: valueOf(env, 'TEMPORAL_TLS_CERT_FILE'),
        keyFile: valueOf(env, 'TEMPORAL_TLS_KEY_FILE'),
        serverName: valueOf(env, 'TEMPORAL_TLS_SERVER_NAME'),
      },
      read,
    );
    if (production && temporalTls === undefined) {
      throw new InvalidConfigError(TEMPORAL_TLS_VARIABLES);
    }
  } catch (error) {
    if (!(error instanceof InvalidConfigError)) throw error;
    for (const variable of error.variables) invalid.add(variable);
  }

  // Mail: TLS and credentials from files.
  const smtpUser = secret('SMTP_USER_FILE');
  const smtpPassword = secret('SMTP_PASSWORD_FILE');
  if (production) {
    if (env.SMTP_SECURE !== 'true' && env.SMTP_SECURE !== 'starttls') invalid.add('SMTP_SECURE');
    if (valueOf(env, 'SMTP_USER_FILE') === undefined) invalid.add('SMTP_USER_FILE');
    if (valueOf(env, 'SMTP_PASSWORD_FILE') === undefined) invalid.add('SMTP_PASSWORD_FILE');
    if (smtpPassword !== undefined && isDevelopmentPassword(smtpPassword)) {
      invalid.add('SMTP_PASSWORD_FILE');
    }
    const appBase = valueOf(env, 'APP_BASE_URL');
    if (appBase !== undefined && !appBase.startsWith('https://')) invalid.add('APP_BASE_URL');
  }
  const smtpAuth: SmtpAuth | undefined =
    smtpUser !== undefined && smtpPassword !== undefined
      ? { user: smtpUser, password: smtpPassword }
      : undefined;
  // The loopback escape hatch of the tests must not even be defined in production.
  if (
    production &&
    env.HTTP_TEST_ALLOW_LOOPBACK !== undefined &&
    env.HTTP_TEST_ALLOW_LOOPBACK !== ''
  ) {
    invalid.add('HTTP_TEST_ALLOW_LOOPBACK');
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
    ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
    // The raw key stays out of the config object: only the decoded buffer travels.
    CREDENTIALS_MASTER_KEY: undefined,
    GEMINI_API_KEY: geminiKey,
    valkeyAuth,
    smtpAuth,
    temporalTls,
    rateLimits: rateLimits.limits,
    llmModels,
    llmPrices: prices.prices,
    llmModelsWithoutPrice: modelsWithoutPrice(
      [...Object.values(llmModels), data.LLM_MODEL_COMPILER],
      prices.prices,
    ),
    llmModelRateLimit: modelLimit,
    credentialsMasterKey,
  };
}

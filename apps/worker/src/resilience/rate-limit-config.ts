import { NODE_TYPES } from '@cognitive-dag/dag-schema';

export interface BucketConfig {
  /** Tokens the bucket holds when full: the burst a burst of requests can use at once. */
  capacity: number;
  refillPerSecond: number;
}

/** Limits by node type; a node type without an entry has no limit (research R3). */
export type RateLimits = Readonly<Record<string, BucketConfig>>;

const PREFIX = 'RATE_LIMIT_';
const MAX_CAPACITY = 10_000;
const MAX_REFILL_PER_SECOND = 10_000;
const MIN_REFILL_PER_SECOND = 0.01;

/** `mock.service` is configured with `RATE_LIMIT_MOCK_SERVICE`. */
export const rateLimitVariable = (nodeType: string): string =>
  `${PREFIX}${nodeType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

/** Parses `capacity:N,refillPerSecond:M`; undefined when the value is not valid. */
export function parseBucketConfig(value: string): BucketConfig | undefined {
  const match = /^capacity:(\d+),refillPerSecond:(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const capacity = Number(match[1]);
  const refillPerSecond = Number(match[2]);
  if (capacity < 1 || capacity > MAX_CAPACITY) return undefined;
  if (refillPerSecond < MIN_REFILL_PER_SECOND || refillPerSecond > MAX_REFILL_PER_SECOND) {
    return undefined;
  }
  return { capacity, refillPerSecond };
}

export interface RateLimitParseResult {
  limits: RateLimits;
  /** Variables that are unknown or malformed; the values are never reported. */
  invalid: string[];
}

/** Reads every `RATE_LIMIT_<NODE_TYPE>` variable of the environment. */
export function parseRateLimits(env: NodeJS.ProcessEnv): RateLimitParseResult {
  const byVariable = new Map(NODE_TYPES.map((type) => [rateLimitVariable(type), type] as const));
  const limits: Record<string, BucketConfig> = {};
  const invalid: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(PREFIX) || value === undefined || value === '') continue;
    const nodeType = byVariable.get(name);
    const config = nodeType === undefined ? undefined : parseBucketConfig(value);
    if (nodeType === undefined || config === undefined) invalid.push(name);
    else limits[nodeType] = config;
  }
  return { limits, invalid: invalid.sort() };
}

import type Valkey from 'iovalkey';
import type { RateLimits } from './rate-limit-config';

export type RateLimitDecision = { granted: true } | { granted: false; retryAfterMs: number };

export interface RateLimiter {
  /** Asks for one token of the bucket of the organization and node type (FR-008). */
  acquire(organizationId: string, nodeType: string): Promise<RateLimitDecision>;
}

/** The longest an idle bucket is kept; a missing bucket starts full, so dropping it is safe. */
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;

/**
 * Token bucket as one atomic script (research R3): refills with the time of the Valkey server,
 * so workers with different clocks agree, takes a token when there is one and otherwise says how
 * long until the next. The bucket is a hash with `tokens` and `updatedAt`.
 */
const TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens = tonumber(bucket[1])
local updatedAt = tonumber(bucket[2])
if tokens == nil or updatedAt == nil then
  tokens = capacity
  updatedAt = now
end
local elapsed = math.max(0, now - updatedAt)
tokens = math.min(capacity, tokens + elapsed * refillPerSecond / 1000)
local granted = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
else
  wait = math.ceil((1 - tokens) * 1000 / refillPerSecond)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updatedAt', tostring(now))
redis.call('EXPIRE', KEYS[1], ttl)
return { granted, wait }
`;

interface BucketCommands {
  tokenBucket: (
    key: string,
    capacity: number,
    refill: number,
    ttl: number,
  ) => Promise<[number, number]>;
}

export interface RateLimiterOptions {
  valkey: Valkey;
  /** Limits by node type; a node type without one is not limited. */
  limits: RateLimits;
}

export const rateLimitKey = (organizationId: string, nodeType: string): string =>
  `rl:${organizationId}:${nodeType}`;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  options.valkey.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET });
  const commands = options.valkey as unknown as BucketCommands;

  return {
    async acquire(organizationId, nodeType) {
      const limit = options.limits[nodeType];
      if (!limit) return { granted: true };
      const ttl = Math.min(
        MAX_TTL_SECONDS,
        Math.max(MIN_TTL_SECONDS, Math.ceil((limit.capacity / limit.refillPerSecond) * 2)),
      );
      const [granted, retryAfterMs] = await commands.tokenBucket(
        rateLimitKey(organizationId, nodeType),
        limit.capacity,
        limit.refillPerSecond,
        ttl,
      );
      return granted === 1 ? { granted: true } : { granted: false, retryAfterMs };
    },
  };
}

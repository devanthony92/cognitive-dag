import { Inject, Injectable } from '@nestjs/common';
import Valkey from 'iovalkey';
import { DomainException, ServiceUnavailableException } from '../common/errors/domain.exception';
import { VALKEY } from '../valkey/valkey.module';

export const compilerUserKey = (userId: string): string => `rl:compiler:user:${userId}`;

const HOUR_SECONDS = 3600;

/**
 * Token bucket as one atomic script, with the clock of the Valkey server (same script as the
 * worker's rate limiter): refills, takes a token when there is one and otherwise says how long
 * until the next. The bucket is a hash with `tokens` and `updatedAt`.
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

interface Commands {
  compilerTokenBucket: (
    key: string,
    capacity: number,
    refill: number,
    ttl: number,
  ) => Promise<[number, number]>;
}

/**
 * Compilations per person per hour (F6, research R13): a bucket of `perHour` tokens that refills
 * `perHour` per hour. If Valkey does not answer, it fails closed with 503.
 */
@Injectable()
export class CompilerRateLimiter {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {
    valkey.defineCommand('compilerTokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET });
  }

  /** Takes one token of the person or throws 429 `COMPILER_RATE_LIMITED` with the wait. */
  async consume(userId: string, perHour: number): Promise<void> {
    let granted: number;
    let waitMs: number;
    try {
      [granted, waitMs] = await (this.valkey as unknown as Commands).compilerTokenBucket(
        compilerUserKey(userId),
        perHour,
        perHour / HOUR_SECONDS,
        2 * HOUR_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException();
    }
    if (granted === 1) return;
    throw new DomainException(
      429,
      'COMPILER_RATE_LIMITED',
      `Llegaste al máximo de ${perHour} compilaciones por hora. Espera antes de volver a intentarlo.`,
      { retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) },
    );
  }
}

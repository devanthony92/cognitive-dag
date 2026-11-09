import type Valkey from 'iovalkey';

/**
 * Circuit breaker per organization and host, stored in Valkey (F7, research R12). The rules are those
 * of the pure state machine in `@cognitive-dag/connectors` (`circuit-breaker.ts`), applied by atomic
 * Lua scripts with the clock of Valkey, like the token bucket of F4.
 *
 * Keys (data-model, "Valkey"):
 * - `cb:<org>:<host>`        hash with `state` (`closed` when absent, `open`) and `openedAt`.
 * - `cb:<org>:<host>:f`      sorted set with the timestamps of the transient failures in the window.
 * - `cb:<org>:<host>:probe`  `SET NX` lock of the single probe of the half-open state.
 *
 * Half-open is implicit: the circuit is `open` and its cooldown has passed. Whoever takes the probe
 * lock is the one request that goes through; its outcome closes the circuit or opens it again.
 */

export interface BreakerSettings {
  /** Transient failures within the window that open the circuit. */
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
}

export type BreakerDecision =
  { allowed: true; probe: boolean } | { allowed: false; retryAfterMs: number };

export interface CircuitBreaker {
  /** Asks whether a call to the host may go out now; a half-open permit is taken by the caller. */
  acquire(organizationId: string, host: string): Promise<BreakerDecision>;
  /**
   * The call got an answer that is not a counted failure. Closes a half-open circuit; `closed`
   * tells whether this call was the one that did.
   */
  success(organizationId: string, host: string, probe: boolean): Promise<{ closed: boolean }>;
  /** A counted failure (5xx, network error, timeout). Returns whether the circuit just opened. */
  failure(organizationId: string, host: string, probe: boolean): Promise<{ opened: boolean }>;
}

/** An idle breaker is forgotten after an hour: a missing one is closed. */
const IDLE_TTL_SECONDS = 3600;

const NOW_MS = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

const ACQUIRE = `${NOW_MS}
local cooldown = tonumber(ARGV[1])
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'open' then return { 1, 0, 0 } end
local openedAt = tonumber(redis.call('HGET', KEYS[1], 'openedAt')) or now
local elapsed = now - openedAt
if elapsed < cooldown then return { 0, 0, cooldown - elapsed } end
local got = redis.call('SET', KEYS[2], '1', 'NX', 'PX', cooldown)
if got then return { 1, 1, 0 } end
local left = redis.call('PTTL', KEYS[2])
if left < 0 then left = cooldown end
return { 0, 0, left }
`;

const FAILURE = `${NOW_MS}
local threshold = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local probe = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local state = redis.call('HGET', KEYS[1], 'state')
if state == 'open' then
  if probe == 1 then
    redis.call('HSET', KEYS[1], 'state', 'open', 'openedAt', tostring(now))
    redis.call('DEL', KEYS[3])
    redis.call('EXPIRE', KEYS[1], ttl)
    return { 1 }
  end
  return { 0 }
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
local member = tostring(now) .. '-' .. tostring(redis.call('ZCARD', KEYS[2]))
redis.call('ZADD', KEYS[2], now, member)
if redis.call('ZCARD', KEYS[2]) >= threshold then
  redis.call('HSET', KEYS[1], 'state', 'open', 'openedAt', tostring(now))
  redis.call('EXPIRE', KEYS[1], ttl)
  redis.call('DEL', KEYS[2])
  redis.call('DEL', KEYS[3])
  return { 1 }
end
redis.call('EXPIRE', KEYS[2], ttl)
return { 0 }
`;

const SUCCESS = `
local probe = tonumber(ARGV[1])
if probe == 1 and redis.call('HGET', KEYS[1], 'state') == 'open' then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  return 1
end
return 0
`;

interface BreakerCommands {
  breakerAcquire(
    hash: string,
    probe: string,
    cooldownMs: number,
  ): Promise<[number, number, number]>;
  breakerFailure(
    hash: string,
    failures: string,
    probe: string,
    threshold: number,
    windowMs: number,
    isProbe: number,
    ttl: number,
  ): Promise<[number]>;
  breakerSuccess(hash: string, failures: string, probe: string, isProbe: number): Promise<number>;
}

export const breakerKey = (organizationId: string, host: string): string =>
  `cb:${organizationId}:${host}`;

export function createValkeyCircuitBreaker(
  valkey: Valkey,
  settings: BreakerSettings,
): CircuitBreaker {
  valkey.defineCommand('breakerAcquire', { numberOfKeys: 2, lua: ACQUIRE });
  valkey.defineCommand('breakerFailure', { numberOfKeys: 3, lua: FAILURE });
  valkey.defineCommand('breakerSuccess', { numberOfKeys: 3, lua: SUCCESS });
  const commands = valkey as unknown as BreakerCommands;
  const keys = (organizationId: string, host: string) => {
    const hash = breakerKey(organizationId, host);
    return { hash, failures: `${hash}:f`, probe: `${hash}:probe` };
  };

  return {
    async acquire(organizationId, host) {
      const k = keys(organizationId, host);
      const [allowed, probe, retryAfterMs] = await commands.breakerAcquire(
        k.hash,
        k.probe,
        settings.cooldownMs,
      );
      return allowed === 1
        ? { allowed: true, probe: probe === 1 }
        : { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
    },
    async success(organizationId, host, probe) {
      const k = keys(organizationId, host);
      const closed = await commands.breakerSuccess(k.hash, k.failures, k.probe, probe ? 1 : 0);
      return { closed: closed === 1 };
    },
    async failure(organizationId, host, probe) {
      const k = keys(organizationId, host);
      const [opened] = await commands.breakerFailure(
        k.hash,
        k.failures,
        k.probe,
        settings.failureThreshold,
        settings.windowMs,
        probe ? 1 : 0,
        IDLE_TTL_SECONDS,
      );
      return { opened: opened === 1 };
    },
  };
}

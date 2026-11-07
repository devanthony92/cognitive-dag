/**
 * Circuit breaker as a pure state machine (research R12). It owns no storage and no clock: the
 * caller passes `now` and keeps the state. In F7 the state lives in Valkey and a Lua script applies
 * these same rules atomically; this module is the reference the script is tested against.
 */

export interface BreakerConfig {
  /** Transient failures within the window that open the circuit. */
  failureThreshold: number;
  windowMs: number;
  /** How long the circuit stays open; also how long a half-open probe holds its lock. */
  cooldownMs: number;
}

export type BreakerStatus = 'closed' | 'open' | 'half_open';

export interface BreakerState {
  readonly status: BreakerStatus;
  /** Timestamps of the failures still inside the window (closed state). */
  readonly failures: readonly number[];
  /** When the circuit opened (open). */
  readonly openedAt: number | null;
  /** When the half-open probe was let through; its lock lasts one cooldown. */
  readonly probeStartedAt: number | null;
}

export function createBreaker(): BreakerState {
  return { status: 'closed', failures: [], openedAt: null, probeStartedAt: null };
}

export interface BreakerDecision {
  allowed: boolean;
  /** True when this call is the single probe of the half-open state. */
  probe: boolean;
  /** When not allowed: how long until it is worth asking again. */
  retryAfterMs?: number;
  /** State after the decision; the caller stores it. */
  state: BreakerState;
}

/** Asks whether a call may go out now. A half-open permit is taken by the call that gets it. */
export function breakerAllows(
  state: BreakerState,
  config: BreakerConfig,
  now: number,
): BreakerDecision {
  if (state.status === 'closed') return { allowed: true, probe: false, state };

  if (state.status === 'open') {
    const elapsed = now - (state.openedAt ?? now);
    if (elapsed < config.cooldownMs) {
      return { allowed: false, probe: false, retryAfterMs: config.cooldownMs - elapsed, state };
    }
    return {
      allowed: true,
      probe: true,
      state: { status: 'half_open', failures: [], openedAt: state.openedAt, probeStartedAt: now },
    };
  }

  // half_open: one probe at a time; a probe that never reported back expires after a cooldown.
  const started = state.probeStartedAt ?? now;
  const elapsed = now - started;
  if (elapsed < config.cooldownMs) {
    return { allowed: false, probe: false, retryAfterMs: config.cooldownMs - elapsed, state };
  }
  return { allowed: true, probe: true, state: { ...state, probeStartedAt: now } };
}

/** A success closes a half-open circuit and wipes the failures; while closed it changes nothing. */
export function recordBreakerSuccess(state: BreakerState): BreakerState {
  return state.status === 'half_open' ? createBreaker() : state;
}

/** A counted failure: the window may open the circuit; a failed probe opens it again. */
export function recordBreakerFailure(
  state: BreakerState,
  config: BreakerConfig,
  now: number,
): BreakerState {
  if (state.status === 'half_open') {
    return { status: 'open', failures: [], openedAt: now, probeStartedAt: null };
  }
  if (state.status === 'open') return state;
  const failures = [...state.failures.filter((at) => now - at < config.windowMs), now];
  if (failures.length >= config.failureThreshold) {
    return { status: 'open', failures: [], openedAt: now, probeStartedAt: null };
  }
  return { ...state, failures };
}

export type CallOutcome =
  | { kind: 'response'; status: number }
  | {
      kind: 'error';
      code: string;
      errorClass: 'transient' | 'timeout' | 'permanent' | 'rate_limited';
    };

/**
 * What the breaker counts: 5xx, network errors and timeouts. Not 429, not other 4xx, and not the
 * permanent failures of the guard itself (SSRF, allowlist, redirects, limits) (research R12).
 */
export function countsAsBreakerFailure(outcome: CallOutcome): boolean {
  if (outcome.kind === 'response') return outcome.status >= 500 && outcome.status <= 599;
  return outcome.errorClass === 'transient' || outcome.errorClass === 'timeout';
}

import { describe, expect, it } from 'vitest';
import {
  breakerAllows,
  countsAsBreakerFailure,
  createBreaker,
  recordBreakerFailure,
  recordBreakerSuccess,
  type BreakerConfig,
  type BreakerState,
} from '../src/index.js';

const config: BreakerConfig = { failureThreshold: 5, windowMs: 60_000, cooldownMs: 30_000 };

/** Drives the pure machine with an injected clock. */
class Harness {
  state: BreakerState = createBreaker();
  now = 1_000_000;

  advance(ms: number): void {
    this.now += ms;
  }

  fail(): void {
    this.state = recordBreakerFailure(this.state, config, this.now);
  }

  succeed(): void {
    this.state = recordBreakerSuccess(this.state);
  }

  /** Asks to call; takes the permit (and the probe) as the caller would. */
  ask() {
    const decision = breakerAllows(this.state, config, this.now);
    this.state = decision.state;
    return decision;
  }
}

describe('circuit breaker state machine (research R12)', () => {
  it('starts closed and lets calls through', () => {
    const h = new Harness();
    expect(h.state.status).toBe('closed');
    expect(h.ask()).toMatchObject({ allowed: true, probe: false });
  });

  it('opens after 5 failures within the window', () => {
    const h = new Harness();
    for (let i = 0; i < 4; i += 1) {
      h.fail();
      h.advance(1000);
    }
    expect(h.state.status).toBe('closed');
    h.fail();
    expect(h.state.status).toBe('open');
  });

  it('forgets failures that fell out of the window', () => {
    const h = new Harness();
    for (let i = 0; i < 4; i += 1) h.fail();
    h.advance(60_001);
    h.fail();
    expect(h.state.status).toBe('closed');
    // Four more inside the new window do open it.
    for (let i = 0; i < 4; i += 1) h.fail();
    expect(h.state.status).toBe('open');
  });

  it('a success while closed does not erase the failures of the window', () => {
    const h = new Harness();
    for (let i = 0; i < 4; i += 1) h.fail();
    h.succeed();
    h.fail();
    expect(h.state.status).toBe('open');
  });

  it('rejects while open and reports the time left of the cooldown', () => {
    const h = new Harness();
    for (let i = 0; i < 5; i += 1) h.fail();
    h.advance(10_000);
    expect(h.ask()).toMatchObject({ allowed: false, retryAfterMs: 20_000 });
    h.advance(19_999);
    expect(h.ask()).toMatchObject({ allowed: false, retryAfterMs: 1 });
  });

  it('goes half-open after the cooldown and lets one probe through', () => {
    const h = new Harness();
    for (let i = 0; i < 5; i += 1) h.fail();
    h.advance(30_000);
    const first = h.ask();
    expect(first).toMatchObject({ allowed: true, probe: true });
    expect(h.state.status).toBe('half_open');
    // Everyone else waits while the probe is in flight.
    expect(h.ask()).toMatchObject({ allowed: false });
    expect(h.ask()).toMatchObject({ allowed: false });
  });

  it('closes again, with a clean slate, when the probe succeeds', () => {
    const h = new Harness();
    for (let i = 0; i < 5; i += 1) h.fail();
    h.advance(30_000);
    h.ask();
    h.succeed();
    expect(h.state.status).toBe('closed');
    expect(h.ask()).toMatchObject({ allowed: true, probe: false });
    for (let i = 0; i < 4; i += 1) h.fail();
    expect(h.state.status).toBe('closed'); // the old failures are gone
  });

  it('opens again for a full cooldown when the probe fails', () => {
    const h = new Harness();
    for (let i = 0; i < 5; i += 1) h.fail();
    h.advance(30_000);
    h.ask();
    h.fail();
    expect(h.state.status).toBe('open');
    h.advance(29_999);
    expect(h.ask()).toMatchObject({ allowed: false, retryAfterMs: 1 });
    h.advance(1);
    expect(h.ask()).toMatchObject({ allowed: true, probe: true });
  });

  it('lets another probe through when the first one was lost', () => {
    const h = new Harness();
    for (let i = 0; i < 5; i += 1) h.fail();
    h.advance(30_000);
    h.ask();
    h.advance(30_000); // the probe never reported back: its lock expired
    expect(h.ask()).toMatchObject({ allowed: true, probe: true });
  });

  it('does not mutate the state it receives', () => {
    const before = createBreaker();
    const frozen = Object.freeze({ ...before, failures: Object.freeze([...before.failures]) });
    expect(() => recordBreakerFailure(frozen as BreakerState, config, 1)).not.toThrow();
    expect(() => breakerAllows(frozen as BreakerState, config, 1)).not.toThrow();
  });
});

describe('what counts as a failure (research R12)', () => {
  it.each([500, 502, 503, 504, 599])('counts HTTP %i', (status) => {
    expect(countsAsBreakerFailure({ kind: 'response', status })).toBe(true);
  });

  it.each([200, 201, 204, 301, 400, 401, 403, 404, 408, 409, 422, 429])(
    'does not count HTTP %i',
    (status) => {
      expect(countsAsBreakerFailure({ kind: 'response', status })).toBe(false);
    },
  );

  it('counts network errors and timeouts', () => {
    expect(
      countsAsBreakerFailure({
        kind: 'error',
        code: 'HTTP_NETWORK_ERROR',
        errorClass: 'transient',
      }),
    ).toBe(true);
    expect(
      countsAsBreakerFailure({ kind: 'error', code: 'HTTP_TIMEOUT', errorClass: 'timeout' }),
    ).toBe(true);
  });

  it('does not count SSRF blocks or other permanent failures', () => {
    for (const code of [
      'SSRF_BLOCKED_ADDRESS',
      'HTTP_HOST_NOT_ALLOWED',
      'HTTP_REDIRECT_NOT_ALLOWED',
      'HTTP_TOO_MANY_REDIRECTS',
      'HTTP_URL_INVALID',
      'HTTP_RESPONSE_TOO_LARGE',
      'HTTP_CONTENT_TYPE_UNSUPPORTED',
      'HTTP_TLS_ERROR',
    ]) {
      expect(countsAsBreakerFailure({ kind: 'error', code, errorClass: 'permanent' })).toBe(false);
    }
  });

  it('429 and 4xx never open the circuit', () => {
    const h = new Harness();
    for (let i = 0; i < 50; i += 1) {
      if (countsAsBreakerFailure({ kind: 'response', status: i % 2 ? 429 : 404 })) h.fail();
    }
    expect(h.state.status).toBe('closed');
  });
});

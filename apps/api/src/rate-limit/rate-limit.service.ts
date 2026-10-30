import { Inject, Injectable } from '@nestjs/common';
import Valkey from 'iovalkey';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import {
  RateLimitedException,
  ServiceUnavailableException,
} from '../common/errors/domain.exception';
import { VALKEY } from '../valkey/valkey.module';
import { PROGRESSIVE_WINDOW_SECONDS, progressiveDelaySeconds } from './progressive';

export interface FixedRule {
  /** Key prefix after `rl:`, e.g. `register:ip` gives `rl:register:ip:<key>`. */
  name: string;
  points: number;
  durationSeconds: number;
}

/** Fixed limits of FR-013. */
export const RATE_RULES = {
  registerIp: { name: 'register:ip', points: 10, durationSeconds: 3600 },
  registerEmail: { name: 'register:email', points: 3, durationSeconds: 3600 },
  resendIp: { name: 'resend:ip', points: 10, durationSeconds: 3600 },
  resendEmail: { name: 'resend:email', points: 3, durationSeconds: 3600 },
  resetIp: { name: 'reset:ip', points: 10, durationSeconds: 3600 },
  resetEmail: { name: 'reset:email', points: 3, durationSeconds: 3600 },
} as const satisfies Record<string, FixedRule>;

/**
 * Rate limits on Valkey. If Valkey does not answer the limiter fails closed with 503 (R10):
 * an unavailable limiter never lets requests through unchecked.
 */
@Injectable()
export class RateLimitService {
  private readonly limiters = new Map<string, RateLimiterRedis>();

  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  /** Counts one hit; throws 429 with the wait when the rule is exhausted. */
  async consume(rule: FixedRule, key: string): Promise<void> {
    try {
      await this.limiter(rule).consume(key);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new RateLimitedException(Math.max(1, Math.ceil(error.msBeforeNext / 1000)));
      }
      throw new ServiceUnavailableException();
    }
  }

  /** Progressive wait for logins: throws 429 while the key is inside its wait period. */
  async assertNotBlocked(prefix: string, key: string): Promise<void> {
    let remainingMs: number;
    try {
      remainingMs = await this.valkey.pttl(this.blockKey(prefix, key));
    } catch {
      throw new ServiceUnavailableException();
    }
    if (remainingMs > 0) throw new RateLimitedException(Math.ceil(remainingMs / 1000));
  }

  /** Registers a failure and starts the wait it earns; returns the number of failures. */
  async recordFailure(prefix: string, key: string): Promise<number> {
    try {
      const counter = this.counterKey(prefix, key);
      const failures = await this.valkey.incr(counter);
      await this.valkey.expire(counter, PROGRESSIVE_WINDOW_SECONDS);
      const delay = progressiveDelaySeconds(failures);
      if (delay > 0) await this.valkey.set(this.blockKey(prefix, key), '1', 'EX', delay);
      return failures;
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  async clearFailures(prefix: string, key: string): Promise<void> {
    try {
      await this.valkey.del(this.counterKey(prefix, key), this.blockKey(prefix, key));
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  private limiter(rule: FixedRule): RateLimiterRedis {
    let limiter = this.limiters.get(rule.name);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: this.valkey,
        keyPrefix: `rl:${rule.name}`,
        points: rule.points,
        duration: rule.durationSeconds,
      });
      this.limiters.set(rule.name, limiter);
    }
    return limiter;
  }

  private counterKey(prefix: string, key: string): string {
    return `rl:${prefix}:${key}`;
  }

  private blockKey(prefix: string, key: string): string {
    return `rl:${prefix}:${key}:wait`;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import Valkey from 'iovalkey';
import { ServiceUnavailableException } from '../common/errors/domain.exception';
import { VALKEY } from '../valkey/valkey.module';

export interface SessionCacheEntry {
  userId: string;
  csrfTokenHash: string;
  expiresAt: string;
}

const key = (tokenHashHex: string) => `sess:${tokenHashHex}`;

/**
 * Valkey side of a session: only the idle window lives here (R5). Any Valkey failure is a 503, so
 * a session store that does not answer never lets a request through.
 */
@Injectable()
export class SessionCache {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  async put(tokenHashHex: string, entry: SessionCacheEntry, ttlSeconds: number): Promise<void> {
    try {
      await this.valkey.set(key(tokenHashHex), JSON.stringify(entry), 'EX', ttlSeconds);
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  /** Renews the idle window; false when the key is gone (idle for 2 h, or Valkey was emptied). */
  async touch(tokenHashHex: string, ttlSeconds: number): Promise<boolean> {
    try {
      return (await this.valkey.expire(key(tokenHashHex), ttlSeconds)) === 1;
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  async remove(tokenHashHex: string): Promise<void> {
    try {
      await this.valkey.del(key(tokenHashHex));
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}

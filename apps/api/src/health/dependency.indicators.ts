import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { Connection } from '@temporalio/client';
import Valkey from 'iovalkey';
import { Pool } from 'pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { TEMPORAL_CONNECTION } from '../temporal/temporal.module';

const CHECK_TIMEOUT_MS = 2_000;

/** Readiness checks for every external dependency. Errors are reduced to up/down. */
@Injectable()
export class DependencyIndicators implements OnApplicationShutdown {
  private readonly pool: Pool;
  private readonly valkey: Valkey;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(TEMPORAL_CONNECTION) private readonly temporal: Connection,
    private readonly indicator: HealthIndicatorService,
  ) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    });
    // Background pool errors (e.g. database restart) must not crash the process.
    this.pool.on('error', () => undefined);
    this.valkey = new Valkey(config.VALKEY_URL, {
      lazyConnect: true,
      connectTimeout: CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.valkey.on('error', () => undefined);
  }

  postgres(): Promise<HealthIndicatorResult> {
    return this.check('postgres', async () => {
      await this.pool.query('SELECT 1');
    });
  }

  valkeyPing(): Promise<HealthIndicatorResult> {
    return this.check('valkey', async () => {
      if (this.valkey.status === 'wait' || this.valkey.status === 'end') {
        await this.valkey.connect();
      }
      await this.valkey.ping();
    });
  }

  temporalHealth(): Promise<HealthIndicatorResult> {
    return this.check('temporal', async () => {
      await this.temporal.withDeadline(Date.now() + CHECK_TIMEOUT_MS, () =>
        this.temporal.healthService.check({}),
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.valkey.disconnect();
    await this.pool.end();
  }

  private async check(key: string, probe: () => Promise<void>): Promise<HealthIndicatorResult> {
    const session = this.indicator.check(key);
    try {
      await withTimeout(probe(), CHECK_TIMEOUT_MS);
      return session.up();
    } catch {
      return session.down();
    }
  }
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

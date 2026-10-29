import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

export const TEMPORAL_CONNECTION = Symbol('TEMPORAL_CONNECTION');
export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');

/**
 * Lazy connection: the API starts even when Temporal is down; readiness reports it and
 * requests that need Temporal fail with SERVICE_UNAVAILABLE.
 */
@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => Connection.lazy({ address: config.TEMPORAL_ADDRESS }),
    },
    {
      provide: TEMPORAL_CLIENT,
      inject: [APP_CONFIG, TEMPORAL_CONNECTION],
      useFactory: (config: AppConfig, connection: Connection) =>
        new Client({ connection, namespace: config.TEMPORAL_NAMESPACE }),
    },
  ],
  exports: [TEMPORAL_CONNECTION, TEMPORAL_CLIENT],
})
export class TemporalModule implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CONNECTION) private readonly connection: Connection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

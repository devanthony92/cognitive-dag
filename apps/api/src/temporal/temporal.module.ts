import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import {
  Client,
  Connection,
  defaultGrpcRetryOptions,
  makeGrpcRetryInterceptor,
} from '@temporalio/client';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

// The SDK default (10 attempts, up to 5 s apart) leaves retry timers alive after the call's
// deadline expires or the connection closes, which then fail on a dead channel. A short budget
// keeps every retry inside the request deadline.
const GRPC_RETRY_ATTEMPTS = 4;

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
      useFactory: (config: AppConfig) =>
        Connection.lazy({
          address: config.TEMPORAL_ADDRESS,
          interceptors: [
            makeGrpcRetryInterceptor(defaultGrpcRetryOptions({ maxAttempts: GRPC_RETRY_ATTEMPTS })),
          ],
        }),
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

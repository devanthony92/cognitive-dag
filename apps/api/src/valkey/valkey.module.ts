import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Valkey from 'iovalkey';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

export const VALKEY = Symbol('VALKEY');

/** Shared client with short timeouts: callers fail closed when Valkey does not answer. */
@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Valkey => {
        const client = new Valkey(config.VALKEY_URL, {
          connectTimeout: 2_000,
          commandTimeout: 2_000,
          maxRetriesPerRequest: 1,
        });
        client.on('error', () => undefined);
        return client;
      },
    },
  ],
  exports: [VALKEY],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  onApplicationShutdown(): void {
    this.valkey.disconnect();
  }
}

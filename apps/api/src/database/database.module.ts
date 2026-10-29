import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

export const DATABASE = Symbol('DATABASE');

/**
 * Pool connected as app_runtime. Every query goes through `DATABASE.withContext` so that
 * row-level security always has a context (research R8).
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabaseClient =>
        createDatabase({ connectionString: config.DATABASE_URL }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.end();
  }
}

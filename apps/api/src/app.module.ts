import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { CorrelationModule } from './common/correlation/correlation.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { JsonBodyMiddleware } from './common/http/json-body.middleware';
import { AuthModule } from './auth/auth.module';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { FlagsModule } from './flags/flags.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PingModule } from './ping/ping.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { SecurityEventsModule } from './security-events/security-events.module';
import { TemporalModule } from './temporal/temporal.module';
import { ValkeyModule } from './valkey/valkey.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      // Order matters: the correlation middleware must run before request logging.
      imports: [
        AppConfigModule.forRoot(config),
        CorrelationModule,
        LoggingModule,
        TemporalModule,
        DatabaseModule,
        ValkeyModule,
        SecurityEventsModule,
        RateLimitModule,
        MailModule,
        FlagsModule.forRoot(config.FEATURE_FLAGS),
        HealthModule,
        PingModule,
        AuthModule,
        WorkflowsModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(JsonBodyMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}

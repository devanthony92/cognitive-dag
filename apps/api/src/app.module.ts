import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { CompilationsModule } from './compilations/compilations.module';
import { CorrelationModule } from './common/correlation/correlation.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { JsonBodyMiddleware } from './common/http/json-body.middleware';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuthModule } from './auth/auth.module';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { CredentialsModule } from './credentials/credentials.module';
import { DatabaseModule } from './database/database.module';
import { FlagsModule } from './flags/flags.module';
import { HealthModule } from './health/health.module';
import { HttpHostsModule } from './http-hosts/http-hosts.module';
import { LlmUsageModule } from './llm-usage/llm-usage.module';
import { MailModule } from './mail/mail.module';
import { PingModule } from './ping/ping.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RunsModule } from './runs/runs.module';
import { SchedulesModule } from './schedules/schedules.module';
import { SecurityEventsModule } from './security-events/security-events.module';
import { TemporalModule } from './temporal/temporal.module';
import { ValkeyModule } from './valkey/valkey.module';
import { WebhooksModule } from './webhooks/webhooks.module';
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
        RunsModule,
        LlmUsageModule,
        CompilationsModule,
        WebhooksModule,
        SchedulesModule,
        CredentialsModule,
        HttpHostsModule,
        ApprovalsModule,
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

import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from '@cognitive-dag/logger';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG, ClsService],
      useFactory: (config: AppConfig, cls: ClsService) => ({
        pinoHttp: {
          ...loggerOptions({ component: 'api', level: config.LOG_LEVEL }),
          genReqId: () => cls.getId(),
          customProps: () => ({ correlationId: cls.getId() }),
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
          },
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { CORRELATION_ID_HEADER, IDEMPOTENCY_KEY_HEADER } from '@cognitive-dag/contracts';
import { AppModule } from './app.module';
import type { AppConfig } from './config/env.schema';

/** Builds the HTTP application. Shared by main.ts and integration tests. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  z.config(z.locales.es());

  const app = await NestFactory.create(AppModule.forRoot(config), {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    allowedHeaders: ['Content-Type', CORRELATION_ID_HEADER, IDEMPOTENCY_KEY_HEADER],
    exposedHeaders: [CORRELATION_ID_HEADER, 'Location'],
  });
  app.enableShutdownHooks();
  return app;
}

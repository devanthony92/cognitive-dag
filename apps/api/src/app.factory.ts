import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import {
  CORRELATION_ID_HEADER,
  CSRF_HEADER,
  IDEMPOTENCY_KEY_HEADER,
} from '@cognitive-dag/contracts';
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
  // Behind Caddy every socket address is the proxy's. Only the closed list of hops is believed, so a
  // client cannot choose its own IP with X-Forwarded-For (FR-005); empty keeps the header ignored.
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', config.TRUSTED_PROXIES.length > 0 ? config.TRUSTED_PROXIES : false);
  app.use(helmet());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    // Cookies cross from the web origin only; the session cookie never goes to another origin (R6).
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'If-Match',
      CORRELATION_ID_HEADER,
      IDEMPOTENCY_KEY_HEADER,
      CSRF_HEADER,
    ],
    exposedHeaders: [CORRELATION_ID_HEADER, 'Location', 'ETag', 'Retry-After'],
  });
  app.enableShutdownHooks();
  return app;
}

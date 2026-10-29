import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/app.factory';
import { parseEnv, type AppConfig } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';

/** Config from the local .env (developer machine) or the CI environment. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadLocalEnv();
  return { ...parseEnv({ ...process.env, LOG_LEVEL: 'warn' }), ...overrides };
}

export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<INestApplication> {
  const app = await createApp(testConfig(overrides));
  await app.init();
  return app;
}

/** Typed HTTP server for supertest (Nest returns `any`). */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

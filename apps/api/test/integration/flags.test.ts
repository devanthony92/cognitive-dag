import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, PublicFeaturesSchema } from '@cognitive-dag/contracts';
import { httpServer } from './helpers';
import { startPingApi, uniqueTaskQueue } from './ping-helpers';

describe('feature flags (requires docker compose up)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function appWith(flags: string): Promise<INestApplication> {
    app = await startPingApi(uniqueTaskQueue(), flags);
    return app;
  }

  it('answers 404 FEATURE_NOT_AVAILABLE when ping-enabled is false', async () => {
    const api = await appWith('{"ping-enabled":false}');
    const response = await request(httpServer(api)).post('/api/v1/pings').expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['x-correlation-id']).toBeDefined();
  });

  it('accepts the ping when ping-enabled is true', async () => {
    const api = await appWith('{"ping-enabled":true}');
    await request(httpServer(api)).post('/api/v1/pings').expect(202);
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['wrong value type', '{"ping-enabled":"yes"}'],
    ['flag missing', '{"other-flag":true}'],
    ['empty object', '{}'],
  ])('evaluates to false with %s', async (_name, flags) => {
    const api = await appWith(flags);
    await request(httpServer(api)).post('/api/v1/pings').expect(404);
    const features = await request(httpServer(api)).get('/api/v1/features').expect(200);
    expect(PublicFeaturesSchema.parse(features.body)).toEqual({ 'ping-enabled': false });
  });

  it('exposes only public flags in /api/v1/features', async () => {
    const api = await appWith('{"ping-enabled":true,"internal-secret-flag":true}');
    const response = await request(httpServer(api)).get('/api/v1/features').expect(200);
    expect(response.body).toEqual({ 'ping-enabled': true });
  });
});

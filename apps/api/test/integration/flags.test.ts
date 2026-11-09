import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicFeaturesSchema } from '@cognitive-dag/contracts';
import { FlagsService } from '../../src/flags/flags.service';
import { httpServer, startTestApp } from './helpers';

describe('feature flags (requires docker compose up)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function appWith(flags: string): Promise<INestApplication> {
    app = await startTestApp({ FEATURE_FLAGS: flags });
    return app;
  }

  it.each([
    ['an empty object', '{}'],
    ['malformed JSON', '{not json'],
    ['a wrong value type', '{"some-flag":"yes"}'],
    ['a flag outside the catalog', '{"internal-secret-flag":true}'],
  ])('exposes an empty catalog in /api/v1/features with %s', async (_name, flags) => {
    const api = await appWith(flags);
    const response = await request(httpServer(api)).get('/api/v1/features').expect(200);
    expect(PublicFeaturesSchema.parse(response.body)).toEqual({});
  });

  it('evaluates an unknown flag as off', async () => {
    const api = await appWith('{}');
    await expect(api.get(FlagsService).isEnabled('no-such-flag')).resolves.toBe(false);
  });

  it('keeps the product routes open without any flag', async () => {
    const api = await appWith('{}');
    const response = await request(httpServer(api)).get('/api/v1/auth/session');
    expect(response.status).not.toBe(404);
  });
});

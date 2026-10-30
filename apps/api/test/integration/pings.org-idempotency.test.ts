import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PingExecutionSchema } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  IDENTITY_FLAGS,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  type LoggedIn,
} from './identity-helpers';
import { uniqueTaskQueue } from './ping-helpers';

describe('ping idempotency per organization (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let alice: LoggedIn;
  let bob: LoggedIn;

  beforeAll(async () => {
    app = await startIdentityApp(IDENTITY_FLAGS, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
    database = openDatabase();
    await resetRateLimits();
    alice = await loginAs(app, await createVerifiedUser(app, database, 'idem-a'));
    bob = await loginAs(app, await createVerifiedUser(app, database, 'idem-b'));
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const start = (session: LoggedIn, key: string) =>
    request(httpServer(app))
      .post(`/api/v1/organizations/${session.body.organizations[0]!.id}/pings`)
      .set(authHeaders(session))
      .set('Idempotency-Key', key)
      .send({});

  it('gives two organizations that use the same key two different pings', async () => {
    const key = randomUUID();
    const first = PingExecutionSchema.parse((await start(alice, key).expect(202)).body);
    const second = PingExecutionSchema.parse((await start(bob, key).expect(202)).body);

    expect(second.pingId).not.toBe(first.pingId);
    // Neither learns that the other used the key: no 404, no shared execution.
    expect(second.pingId).toMatch(
      /^ping-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(first.pingId).toMatch(
      /^ping-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('still returns the same ping for the same key inside one organization', async () => {
    const key = randomUUID();
    const first = PingExecutionSchema.parse((await start(alice, key).expect(202)).body);
    const again = PingExecutionSchema.parse((await start(alice, key).expect(202)).body);
    expect(again.pingId).toBe(first.pingId);
  });

  it('does not let another organization read a ping through its id', async () => {
    const key = randomUUID();
    const mine = PingExecutionSchema.parse((await start(alice, key).expect(202)).body);
    await request(httpServer(app))
      .get(`/api/v1/organizations/${bob.body.organizations[0]!.id}/pings/${mine.pingId}`)
      .set('Cookie', bob.cookie)
      .expect(404);
  });
});

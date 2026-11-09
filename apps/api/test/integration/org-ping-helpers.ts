import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DatabaseClient } from '@cognitive-dag/db';
import type { AppConfig } from '../../src/config/env.schema';
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

export interface OrgPingEnv {
  app: INestApplication;
  database: DatabaseClient;
  session: LoggedIn;
  /** `/api/v1/organizations/{id}/pings` of the user's personal organization. */
  base: string;
  post(): request.Test;
  get(pingId: string): request.Test;
  close(): Promise<void>;
}

/** An app with a signed-in owner, for the tests of the organization ping (the only ping route). */
export async function setupOrgPing(overrides: Partial<AppConfig> = {}): Promise<OrgPingEnv> {
  const app = await startIdentityApp(IDENTITY_FLAGS, overrides);
  const database = openDatabase();
  await resetRateLimits();
  const session = await loginAs(app, await createVerifiedUser(app, database, 'ping'));
  const base = `/api/v1/organizations/${session.body.organizations[0]!.id}/pings`;
  return {
    app,
    database,
    session,
    base,
    post: () => request(httpServer(app)).post(base).set(authHeaders(session)),
    get: (pingId) =>
      request(httpServer(app)).get(`${base}/${pingId}`).set('Cookie', session.cookie),
    async close() {
      await app.close();
      await database.end();
    },
  };
}

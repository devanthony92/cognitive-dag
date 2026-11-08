import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HttpAllowedHost, HttpAllowedHostList } from '@cognitive-dag/contracts';
import { authHeaders } from './identity-helpers';
import {
  api,
  closeTriggersEnv,
  orgPath,
  setupTriggersEnv,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv({}, { withWorker: false });
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

const path = () => `${orgPath(env)}/http-allowed-hosts`;
const add = (session: TriggersEnv['owner'], pattern: unknown) =>
  api(env).post(path()).set(authHeaders(session)).send({ pattern });

describe('allowlist of destinations', () => {
  it('lets only the owner add and remove, and owners and editors read', async () => {
    const entry = (await add(env.owner, 'api.example.com').expect(201)).body as HttpAllowedHost;
    expect(entry.pattern).toBe('api.example.com');

    for (const session of [env.editor, env.viewer]) {
      await add(session, 'otro.example.com').expect(403);
      await api(env).delete(`${path()}/${entry.id}`).set(authHeaders(session)).expect(403);
    }
    for (const session of [env.owner, env.editor]) {
      const list = await api(env).get(path()).set(authHeaders(session)).expect(200);
      expect((list.body as HttpAllowedHostList).items.map((item) => item.pattern)).toContain(
        'api.example.com',
      );
    }
    await api(env).get(path()).set(authHeaders(env.viewer)).expect(403);
    await api(env).get(path()).set(authHeaders(env.outsider)).expect(404);

    await api(env).delete(`${path()}/${entry.id}`).set(authHeaders(env.owner)).expect(204);
    const list = await api(env).get(path()).set(authHeaders(env.owner)).expect(200);
    expect((list.body as HttpAllowedHostList).items.map((item) => item.pattern)).not.toContain(
      'api.example.com',
    );
    // Removing it again: it is no longer there.
    await api(env).delete(`${path()}/${entry.id}`).set(authHeaders(env.owner)).expect(404);
  });

  it('accepts a wildcard and refuses what is not a domain with 422', async () => {
    await add(env.owner, '*.partner.example').expect(201);
    for (const pattern of [
      '10.0.0.1',
      '*.com',
      'API.example.com',
      'https://api.example.com',
      'api.example.com:8443',
      'api.example.com/ruta',
      'a*.example.com',
      'sin-punto',
      '',
    ]) {
      const response = await add(env.owner, pattern);
      expect(response.status, pattern).toBe(422);
      expect(problemOf(response).code).toBe('VALIDATION_FAILED');
    }
    await add(env.owner, 42).expect(422);
  });

  it('answers 409 for a duplicate and 422 for the 101st entry', async () => {
    await add(env.owner, 'dup.example.com').expect(201);
    const dup = await add(env.owner, 'dup.example.com').expect(409);
    expect(problemOf(dup).code).toBe('HTTP_HOST_EXISTS');

    const current = (await api(env).get(path()).set(authHeaders(env.owner)).expect(200))
      .body as HttpAllowedHostList;
    for (let i = current.items.length; i < 100; i += 1) {
      await add(env.owner, `host-${i}.example.com`).expect(201);
    }
    const over = await add(env.owner, 'one-too-many.example.com').expect(422);
    expect(problemOf(over).code).toBe('HTTP_HOST_LIMIT_REACHED');
  }, 60_000);
});

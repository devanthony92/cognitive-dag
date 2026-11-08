import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@cognitive-dag/db';
import type { Credential, CredentialList } from '@cognitive-dag/contracts';
import { authHeaders } from './identity-helpers';
import { httpServer, startTestApp } from './helpers';
import {
  TRIGGER_FLAGS,
  api,
  closeTriggersEnv,
  orgPath,
  setupTriggersEnv,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';
import { createWorkflow, publish, saveDraft } from './workflows-helpers';
import request from 'supertest';

let env: TriggersEnv;
let withoutKey: INestApplication | undefined;

// A recognizable value to look for in every response, row and event. Not a real secret.
const SECRET = 'SECRET-CANARY-0001';

beforeAll(async () => {
  env = await setupTriggersEnv({}, { withWorker: false });
}, 120_000);

afterAll(async () => {
  await withoutKey?.close();
  await closeTriggersEnv(env);
});

const create = (
  session: TriggersEnv['owner'],
  body: Record<string, unknown>,
  organizationId = env.organization.id,
) =>
  api(env)
    .post(`/api/v1/organizations/${organizationId}/credentials`)
    .set(authHeaders(session))
    .send(body);

let counter = 0;
const unique = () => `Credencial ${Date.now()}-${(counter += 1)}`;
const bearer = (name = unique(), secret = SECRET) => ({ name, kind: 'bearer', secret });

describe('credentials', () => {
  it('lets only the owner create, rotate and archive; the secret is never returned', async () => {
    const created = await create(env.owner, bearer()).expect(201);
    const credential = created.body as Credential;
    expect(credential).toMatchObject({ kind: 'bearer', headerName: null, rotatedAt: null });
    expect(JSON.stringify(created.body)).not.toContain(SECRET);
    expect(created.body).not.toHaveProperty('secret');

    for (const session of [env.editor, env.viewer]) {
      await create(session, bearer()).expect(403);
      await api(env)
        .put(`${orgPath(env)}/credentials/${credential.id}`)
        .set(authHeaders(session))
        .send({ secret: 'otro' })
        .expect(403);
      await api(env)
        .delete(`${orgPath(env)}/credentials/${credential.id}`)
        .set(authHeaders(session))
        .expect(403);
    }

    const rotated = await api(env)
      .put(`${orgPath(env)}/credentials/${credential.id}`)
      .set(authHeaders(env.owner))
      .send({ secret: `${SECRET}-rotado` })
      .expect(200);
    expect((rotated.body as Credential).rotatedAt).not.toBeNull();
    expect(JSON.stringify(rotated.body)).not.toContain('rotado');

    await api(env)
      .delete(`${orgPath(env)}/credentials/${credential.id}`)
      .set(authHeaders(env.owner))
      .expect(204);
    const archived = await api(env)
      .put(`${orgPath(env)}/credentials/${credential.id}`)
      .set(authHeaders(env.owner))
      .send({ secret: 'otro' })
      .expect(409);
    expect(problemOf(archived).code).toBe('CREDENTIAL_ARCHIVED');
  });

  it('lists metadata for owners and editors, and closes the list to viewers and outsiders', async () => {
    const credential = (await create(env.owner, bearer()).expect(201)).body as Credential;
    for (const session of [env.owner, env.editor]) {
      const list = await api(env)
        .get(`${orgPath(env)}/credentials`)
        .set(authHeaders(session))
        .expect(200);
      const items = (list.body as CredentialList).items;
      expect(items.map((item) => item.id)).toContain(credential.id);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
    }
    await api(env)
      .get(`${orgPath(env)}/credentials`)
      .set(authHeaders(env.viewer))
      .expect(403);
    await api(env)
      .get(`${orgPath(env)}/credentials`)
      .set(authHeaders(env.outsider))
      .expect(404);
  });

  it('keeps the secret out of the database in the clear', async () => {
    const credential = (await create(env.owner, bearer()).expect(201)).body as Credential;
    const rows = await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) =>
        // Every encrypted column, as text, to look for the plaintext anywhere in the row.
        tx.execute<{ blobs: string }>(
          sql`SELECT encode(secret_ct || dek_wrapped || secret_iv || dek_iv, 'escape') AS blobs
              FROM credentials WHERE id = ${credential.id}`,
        ),
    );
    expect(rows.rows[0]?.blobs ?? '').not.toContain(SECRET);
  });

  it('answers 409 for a repeated name, which is free again once archived', async () => {
    const name = unique();
    const first = (await create(env.owner, bearer(name)).expect(201)).body as Credential;
    const again = await create(env.owner, bearer(name)).expect(409);
    expect(problemOf(again).code).toBe('CREDENTIAL_NAME_TAKEN');
    await api(env)
      .delete(`${orgPath(env)}/credentials/${first.id}`)
      .set(authHeaders(env.owner))
      .expect(204);
    await create(env.owner, bearer(name)).expect(201);
  });

  it('answers 422 for a forbidden header name and for malformed secrets', async () => {
    for (const headerName of [
      'Authorization',
      'Host',
      'Proxy-Authorization',
      'Cookie',
      'bad name',
    ]) {
      const response = await create(env.owner, {
        name: unique(),
        kind: 'api_key_header',
        headerName,
        secret: SECRET,
      }).expect(422);
      expect(problemOf(response).code).toBe('VALIDATION_FAILED');
    }
    await create(env.owner, { name: unique(), kind: 'api_key_header', secret: SECRET }).expect(422);
    await create(env.owner, {
      name: unique(),
      kind: 'bearer',
      headerName: 'X-Key',
      secret: SECRET,
    }).expect(422);
    await create(env.owner, { name: unique(), kind: 'basic', secret: 'sin-dos-puntos' }).expect(
      422,
    );
    await create(env.owner, { ...bearer(), secret: '' }).expect(422);
    await create(env.owner, {
      name: unique(),
      kind: 'api_key_header',
      headerName: 'X-Api-Key',
      secret: SECRET,
    }).expect(201);
    await create(env.owner, { name: unique(), kind: 'basic', secret: 'usuario:clave' }).expect(201);
  });

  it('answers 503 CREDENTIALS_NOT_CONFIGURED when the server has no master key', async () => {
    withoutKey = await startTestApp({
      FEATURE_FLAGS: TRIGGER_FLAGS,
      credentialsMasterKey: undefined,
    });
    const response = await request(httpServer(withoutKey))
      .post(`${orgPath(env)}/credentials`)
      .set(authHeaders(env.owner))
      .send(bearer())
      .expect(503);
    expect(problemOf(response).code).toBe('CREDENTIALS_NOT_CONFIGURED');
  });
});

describe('publishing a node that names a credential', () => {
  const httpNode = (credentialId: string) => ({
    schemaVersion: 1,
    nodes: [
      {
        id: 'trigger',
        type: 'trigger.manual',
        label: 'Inicio',
        position: { x: 0, y: 0 },
        config: { inputSchema: [] },
      },
      {
        id: 'call',
        type: 'http.request',
        label: 'Llamada',
        position: { x: 200, y: 0 },
        config: {
          method: 'GET',
          url: 'https://api.example.com/datos',
          headers: {},
          body: '',
          credentialId,
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'out', target: 'call' }],
  });

  const attempt = async (credentialId: string) => {
    const workflow = await createWorkflow(env);
    const draft = await saveDraft(env, env.owner, workflow.id, 1, httpNode(credentialId)).expect(
      200,
    );
    return await publish(
      env,
      env.owner,
      workflow.id,
      (draft.body as { revision: number }).revision,
    );
  };

  it('publishes with a live credential of the organization', async () => {
    const credential = (await create(env.owner, bearer()).expect(201)).body as Credential;
    expect((await attempt(credential.id)).status).toBe(201);
  });

  it('answers 422 CREDENTIAL_NOT_FOUND for a missing, archived or foreign credential', async () => {
    const archived = (await create(env.owner, bearer()).expect(201)).body as Credential;
    await api(env)
      .delete(`${orgPath(env)}/credentials/${archived.id}`)
      .set(authHeaders(env.owner))
      .expect(204);
    const foreign = (await create(env.outsider, bearer(), env.outsiderOrganization.id).expect(201))
      .body as Credential;

    for (const id of [randomUUID(), archived.id, foreign.id]) {
      const response = await attempt(id);
      expect(response.status).toBe(422);
      expect(problemOf(response).code).toBe('DAG_INVALID');
      expect(JSON.stringify(problemOf(response).dagErrors)).toContain('CREDENTIAL_NOT_FOUND');
    }
  });
});

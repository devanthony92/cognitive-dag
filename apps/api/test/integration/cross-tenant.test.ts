import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, type OrganizationSummary } from '@cognitive-dag/contracts';
import { eq, memberships, type DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import { uniqueTaskQueue } from './ping-helpers';
import { DAG_FLAGS, validDefinition } from './workflows-helpers';

/**
 * Every endpoint under /organizations/{id} (SC-002); each row is exercised against every way of
 * reaching someone else's organization.
 */
interface Endpoint {
  name: string;
  /** False when the endpoint takes no resource id, so there is no foreign resource to aim at. */
  takesResource: boolean;
  /** Builds the request; `resource` is something owned by the organization the path names. */
  call: (
    app: INestApplication,
    session: LoggedIn,
    organizationId: string,
    resource: Resources,
  ) => request.Test;
}

interface Resources {
  pingId: string;
  /** The owner's membership in the organization the resources belong to. */
  membershipId: string;
  invitationId: string;
  workflowId: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    name: 'POST /organizations/{id}/pings',
    takesResource: false,
    call: (app, session, organizationId) =>
      request(httpServer(app))
        .post(`/api/v1/organizations/${organizationId}/pings`)
        .set(authHeaders(session))
        .set('Idempotency-Key', randomUUID())
        .send({}),
  },
  {
    name: 'GET /organizations/{id}/pings/{pingId}',
    takesResource: true,
    call: (app, session, organizationId, resource) =>
      request(httpServer(app))
        .get(`/api/v1/organizations/${organizationId}/pings/${resource.pingId}`)
        .set('Cookie', session.cookie),
  },
  {
    name: 'GET /organizations/{id}/members',
    takesResource: false,
    call: (app, session, organizationId) =>
      request(httpServer(app))
        .get(`/api/v1/organizations/${organizationId}/members`)
        .set('Cookie', session.cookie),
  },
  {
    name: 'PATCH /organizations/{id}/members/{membershipId}',
    takesResource: true,
    call: (app, session, organizationId, resource) =>
      request(httpServer(app))
        .patch(`/api/v1/organizations/${organizationId}/members/${resource.membershipId}`)
        .set(authHeaders(session))
        .send({ role: 'viewer' }),
  },
  {
    name: 'DELETE /organizations/{id}/members/{membershipId}',
    takesResource: true,
    call: (app, session, organizationId, resource) =>
      request(httpServer(app))
        .delete(`/api/v1/organizations/${organizationId}/members/${resource.membershipId}`)
        .set(authHeaders(session)),
  },
  {
    name: 'GET /organizations/{id}/invitations',
    takesResource: false,
    call: (app, session, organizationId) =>
      request(httpServer(app))
        .get(`/api/v1/organizations/${organizationId}/invitations`)
        .set('Cookie', session.cookie),
  },
  {
    name: 'POST /organizations/{id}/invitations',
    takesResource: false,
    call: (app, session, organizationId) =>
      request(httpServer(app))
        .post(`/api/v1/organizations/${organizationId}/invitations`)
        .set(authHeaders(session))
        .send({ email: 'someone@example.test', role: 'viewer' }),
  },
  {
    name: 'DELETE /organizations/{id}/invitations/{invitationId}',
    takesResource: true,
    call: (app, session, organizationId, resource) =>
      request(httpServer(app))
        .delete(`/api/v1/organizations/${organizationId}/invitations/${resource.invitationId}`)
        .set(authHeaders(session)),
  },
  ...workflowEndpoints(),
];

function workflowEndpoints(): Endpoint[] {
  const root = (organizationId: string) => `/api/v1/organizations/${organizationId}/workflows`;
  const withId = (organizationId: string, resource: Resources) =>
    `${root(organizationId)}/${resource.workflowId}`;
  return [
    {
      name: 'GET /organizations/{id}/workflows',
      takesResource: false,
      call: (app, session, organizationId) =>
        request(httpServer(app)).get(root(organizationId)).set('Cookie', session.cookie),
    },
    {
      name: 'POST /organizations/{id}/workflows',
      takesResource: false,
      call: (app, session, organizationId) =>
        request(httpServer(app))
          .post(root(organizationId))
          .set(authHeaders(session))
          .send({ name: 'Ajeno' }),
    },
    {
      name: 'GET /organizations/{id}/limits',
      takesResource: false,
      call: (app, session, organizationId) =>
        request(httpServer(app))
          .get(`/api/v1/organizations/${organizationId}/limits`)
          .set('Cookie', session.cookie),
    },
    {
      name: 'GET /organizations/{id}/workflows/{workflowId}',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .get(withId(organizationId, resource))
          .set('Cookie', session.cookie),
    },
    {
      name: 'PATCH /organizations/{id}/workflows/{workflowId}',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .patch(withId(organizationId, resource))
          .set(authHeaders(session))
          .send({ name: 'Robado' }),
    },
    {
      name: 'DELETE /organizations/{id}/workflows/{workflowId}',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app)).delete(withId(organizationId, resource)).set(authHeaders(session)),
    },
    {
      name: 'PUT /organizations/{id}/workflows/{workflowId}/draft',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .put(`${withId(organizationId, resource)}/draft`)
          .set(authHeaders(session))
          .set('If-Match', '"2"')
          .send({ definition: validDefinition() }),
    },
    {
      name: 'POST /organizations/{id}/workflows/{workflowId}/draft/from-version/{n}',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .post(`${withId(organizationId, resource)}/draft/from-version/1`)
          .set(authHeaders(session))
          .set('If-Match', '"2"'),
    },
    {
      name: 'GET /organizations/{id}/workflows/{workflowId}/versions',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .get(`${withId(organizationId, resource)}/versions`)
          .set('Cookie', session.cookie),
    },
    {
      name: 'POST /organizations/{id}/workflows/{workflowId}/versions',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .post(`${withId(organizationId, resource)}/versions`)
          .set(authHeaders(session))
          .set('If-Match', '"2"'),
    },
    {
      name: 'GET /organizations/{id}/workflows/{workflowId}/versions/{n}',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .get(`${withId(organizationId, resource)}/versions/1`)
          .set('Cookie', session.cookie),
    },
    {
      name: 'POST /organizations/{id}/workflows/{workflowId}/versions/{n}/activate',
      takesResource: true,
      call: (app, session, organizationId, resource) =>
        request(httpServer(app))
          .post(`${withId(organizationId, resource)}/versions/1/activate`)
          .set(authHeaders(session)),
    },
  ];
}

describe('cross-tenant access (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceSession: LoggedIn;
  let bobSession: LoggedIn;
  let aliceOrg: OrganizationSummary;
  let bobOrg: OrganizationSummary;
  let carolSession: LoggedIn;
  let sharedOrgId: string;
  let bobPingId: string;
  let bobResources: Resources;

  beforeAll(async () => {
    app = await startIdentityApp(DAG_FLAGS, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
    database = openDatabase();
    await resetRateLimits();
    alice = await createVerifiedUser(app, database, 'tenant-a');
    bob = await createVerifiedUser(app, database, 'tenant-b');
    aliceSession = await loginAs(app, alice);
    bobSession = await loginAs(app, bob);
    aliceOrg = aliceSession.body.organizations[0]!;
    bobOrg = bobSession.body.organizations[0]!;

    const created = await request(httpServer(app))
      .post(`/api/v1/organizations/${bobOrg.id}/pings`)
      .set(authHeaders(bobSession))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(202);
    bobPingId = (created.body as { pingId: string }).pingId;
    const bobMembers = await request(httpServer(app))
      .get(`/api/v1/organizations/${bobOrg.id}/members`)
      .set('Cookie', bobSession.cookie)
      .expect(200);
    const invited = await request(httpServer(app))
      .post(`/api/v1/organizations/${bobOrg.id}/invitations`)
      .set(authHeaders(bobSession))
      .send({ email: 'bobs-guest@example.test', role: 'viewer' })
      .expect(201);
    const bobWorkflow = await request(httpServer(app))
      .post(`/api/v1/organizations/${bobOrg.id}/workflows`)
      .set(authHeaders(bobSession))
      .send({ name: 'Flujo de Bob' })
      .expect(201);
    const bobWorkflowId = (bobWorkflow.body as { id: string }).id;
    await request(httpServer(app))
      .put(`/api/v1/organizations/${bobOrg.id}/workflows/${bobWorkflowId}/draft`)
      .set(authHeaders(bobSession))
      .set('If-Match', '"1"')
      .send({ definition: validDefinition() })
      .expect(200);
    await request(httpServer(app))
      .post(`/api/v1/organizations/${bobOrg.id}/workflows/${bobWorkflowId}/versions`)
      .set(authHeaders(bobSession))
      .set('If-Match', '"2"')
      .expect(201);
    bobResources = {
      workflowId: bobWorkflowId,
      pingId: bobPingId,
      membershipId: (bobMembers.body as { membershipId: string }[])[0]!.membershipId,
      invitationId: (invited.body as { id: string }).id,
    };

    // Carol owned a shared organization with Bob and was then removed from it (soft delete).
    const carol = await createVerifiedUser(app, database, 'tenant-c');
    carolSession = await loginAs(app, carol);
    const shared = await request(httpServer(app))
      .post('/api/v1/organizations')
      .set(authHeaders(carolSession))
      .send({ name: 'Equipo C' })
      .expect(201);
    sharedOrgId = (shared.body as OrganizationSummary).id;
    await database.withContext({ userId: carol.id, organizationId: sharedOrgId }, async (tx) => {
      await tx
        .insert(memberships)
        .values({ organizationId: sharedOrgId, userId: bob.id, role: 'owner' });
      await tx
        .update(memberships)
        .set({ deletedAt: new Date() })
        .where(eq(memberships.userId, carol.id));
    });
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  async function expectNotFound(response: request.Test): Promise<void> {
    const result = await response.expect(404);
    const problem = ProblemDetailsSchema.parse(result.body);
    expect(problem.code).toBe('NOT_FOUND');
    // The same body for every kind of miss: nothing says whether the organization exists.
    expect(problem.detail).toBe('No se encontró el recurso solicitado.');
  }

  it('sanity: the owner reaches its own organization', async () => {
    await request(httpServer(app))
      .get(`/api/v1/organizations/${bobOrg.id}/pings/${bobPingId}`)
      .set('Cookie', bobSession.cookie)
      .expect(200);
  });

  describe.each(ENDPOINTS)('$name', (endpoint) => {
    it('404 for a user who is not a member of the organization', async () => {
      await expectNotFound(endpoint.call(app, aliceSession, bobOrg.id, bobResources));
    });

    it('404 for an organization that does not exist', async () => {
      await expectNotFound(endpoint.call(app, aliceSession, randomUUID(), bobResources));
    });

    it('404 for an id that is not a UUID', async () => {
      await expectNotFound(endpoint.call(app, aliceSession, 'not-a-uuid', bobResources));
    });

    it.runIf(endpoint.takesResource)(
      '404 for a resource of another organization reached through an organization of the user',
      async () => {
        await expectNotFound(endpoint.call(app, aliceSession, aliceOrg.id, bobResources));
      },
    );

    it('404 after the membership was removed (soft delete)', async () => {
      await expectNotFound(endpoint.call(app, carolSession, sharedOrgId, bobResources));
    });
  });

  it('answers 401 UNAUTHENTICATED, not 404, when there is no session at all', async () => {
    const response = await request(httpServer(app))
      .get(`/api/v1/organizations/${bobOrg.id}/pings/${bobPingId}`)
      .expect(401);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('UNAUTHENTICATED');
  });
});

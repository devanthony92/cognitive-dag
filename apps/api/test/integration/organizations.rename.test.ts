import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationSummarySchema,
  ProblemDetailsSchema,
  SessionInfoSchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  IDENTITY_FLAGS,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  uniqueEmail,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import { createOrganization, invite, joinAs } from './members-helpers';
import { uniqueTaskQueue } from './ping-helpers';

describe('renaming an organization (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let owner: TestUser;
  let ownerSession: LoggedIn;
  let organization: OrganizationSummary;
  let editor: Awaited<ReturnType<typeof joinAs>>;
  let viewer: Awaited<ReturnType<typeof joinAs>>;

  beforeAll(async () => {
    app = await startIdentityApp(IDENTITY_FLAGS, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
    database = openDatabase();
    await resetRateLimits();
    owner = await createVerifiedUser(app, database, 'rename-owner');
    ownerSession = await loginAs(app, owner);
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(async () => {
    await resetRateLimits();
    organization = await createOrganization(app, ownerSession, 'Nombre original');
    editor = await joinAs(app, database, ownerSession, organization.id, 'editor');
    viewer = await joinAs(app, database, ownerSession, organization.id, 'viewer');
  });

  const api = () => request(httpServer(app));
  const url = () => `/api/v1/organizations/${organization.id}`;
  const rename = (session: LoggedIn, name: unknown) =>
    api().patch(url()).set(authHeaders(session)).send({ name });
  const nameSeenByOwner = async () => {
    const response = await api().get('/api/v1/auth/session').set('Cookie', ownerSession.cookie);
    const info = SessionInfoSchema.parse(response.body);
    return info.organizations.find((item) => item.id === organization.id)?.name;
  };

  it('lets an owner rename and returns the summary', async () => {
    const response = await rename(ownerSession, '  Nuevo nombre  ').expect(200);
    expect(OrganizationSummarySchema.parse(response.body)).toEqual({
      id: organization.id,
      name: 'Nuevo nombre',
      role: 'owner',
      isPersonal: false,
    });
    expect(await nameSeenByOwner()).toBe('Nuevo nombre');
  });

  it('also renames the personal organization', async () => {
    const personal = ownerSession.body.organizations.find((item) => item.isPersonal)!;
    const response = await api()
      .patch(`/api/v1/organizations/${personal.id}`)
      .set(authHeaders(ownerSession))
      .send({ name: 'Mi espacio' })
      .expect(200);
    expect(OrganizationSummarySchema.parse(response.body)).toMatchObject({
      isPersonal: true,
      name: 'Mi espacio',
    });
  });

  it.each(['editor', 'viewer'] as const)('answers 403 FORBIDDEN to a %s', async (role) => {
    const session = role === 'editor' ? editor.session : viewer.session;
    const response = await rename(session, 'Intento').expect(403);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
    expect(await nameSeenByOwner()).toBe('Nombre original');
  });

  it('answers 404 NOT_FOUND to a non-member', async () => {
    const stranger = await createVerifiedUser(app, database, 'rename-stranger');
    const response = await rename(await loginAs(app, stranger), 'Intento').expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('needs a session and the CSRF token', async () => {
    await api().patch(url()).send({ name: 'x' }).expect(401);
    const response = await api()
      .patch(url())
      .set('Cookie', ownerSession.cookie)
      .send({ name: 'x' })
      .expect(403);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('CSRF_REJECTED');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 100 characters', 'n'.repeat(101)],
    ['not a string', 42],
  ])('rejects a %s name with 422', async (_case, name) => {
    const response = await rename(ownerSession, name).expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects unknown properties with 422', async () => {
    await api()
      .patch(url())
      .set(authHeaders(ownerSession))
      .send({ name: 'Bien', isPersonal: true })
      .expect(422);
  });

  it('emits org.renamed without the names', async () => {
    const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
    await rename(ownerSession, 'Nombre secreto-123').expect(200);
    const events = emit.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'org.renamed',
        outcome: 'success',
        userId: owner.id,
        organizationId: organization.id,
      }),
    );
    expect(JSON.stringify(events)).not.toContain('Nombre secreto-123');
    emit.mockRestore();
  });

  it('shows the current name in a pending invitation preview', async () => {
    const { token } = await invite(app, ownerSession, organization.id, uniqueEmail('r'), 'viewer');
    await rename(ownerSession, 'Nombre vigente').expect(200);
    const response = await api().post('/api/v1/invitations/preview').send({ token }).expect(200);
    expect(response.body).toMatchObject({ organizationName: 'Nombre vigente' });
  });
});

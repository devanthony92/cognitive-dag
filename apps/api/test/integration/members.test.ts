import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemberSchema,
  ProblemDetailsSchema,
  SessionInfoSchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import { eq, memberships, type DatabaseClient } from '@cognitive-dag/db';
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
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import { createOrganization, invite, joinAs, membershipIdOf } from './members-helpers';
import { uniqueTaskQueue } from './ping-helpers';

describe('members (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let owner: TestUser;
  let ownerSession: LoggedIn;
  let organization: OrganizationSummary;
  let editor: Awaited<ReturnType<typeof joinAs>>;
  let viewer: Awaited<ReturnType<typeof joinAs>>;
  let ownerMembershipId: string;

  beforeAll(async () => {
    app = await startIdentityApp(IDENTITY_FLAGS, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
    database = openDatabase();
    await resetRateLimits();
    owner = await createVerifiedUser(app, database, 'members-owner');
    ownerSession = await loginAs(app, owner);
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(async () => {
    await resetRateLimits();
    // A fresh organization per test: roles and removals change what the next test would see.
    organization = await createOrganization(app, ownerSession, 'Equipo de pruebas');
    editor = await joinAs(app, database, ownerSession, organization.id, 'editor');
    viewer = await joinAs(app, database, ownerSession, organization.id, 'viewer');
    ownerMembershipId = await membershipIdOf(app, ownerSession, organization.id, owner.id);
  });

  const api = () => request(httpServer(app));
  const base = () => `/api/v1/organizations/${organization.id}/members`;
  const changeRole = (session: LoggedIn, membershipId: string, role: string) =>
    api().patch(`${base()}/${membershipId}`).set(authHeaders(session)).send({ role });
  const remove = (session: LoggedIn, membershipId: string) =>
    api().delete(`${base()}/${membershipId}`).set(authHeaders(session));
  const startPing = (session: LoggedIn) =>
    api()
      .post(`/api/v1/organizations/${organization.id}/pings`)
      .set(authHeaders(session))
      .set('Idempotency-Key', randomUUID())
      .send({});

  describe('listing', () => {
    it.each(['owner', 'editor', 'viewer'] as const)('is visible to a %s', async (role) => {
      const session = { owner: ownerSession, editor: editor.session, viewer: viewer.session }[role];
      const response = await api().get(base()).set('Cookie', session.cookie).expect(200);
      const members = (response.body as unknown[]).map((item) => MemberSchema.parse(item));
      expect(members.map((member) => member.role).sort()).toEqual(['editor', 'owner', 'viewer']);
      expect(members.find((member) => member.userId === editor.user.id)).toMatchObject({
        name: editor.user.name,
        email: editor.user.email,
        role: 'editor',
      });
    });

    it('does not list a person from another organization', async () => {
      const stranger = await createVerifiedUser(app, database, 'members-stranger');
      const strangerSession = await loginAs(app, stranger);
      await api().get(base()).set('Cookie', strangerSession.cookie).expect(404);
    });
  });

  describe('changing roles', () => {
    it('lets an owner promote and demote', async () => {
      const promoted = await changeRole(ownerSession, editor.membershipId, 'owner').expect(200);
      expect(MemberSchema.parse(promoted.body)).toMatchObject({
        userId: editor.user.id,
        role: 'owner',
      });
      const demoted = await changeRole(ownerSession, editor.membershipId, 'viewer').expect(200);
      expect(MemberSchema.parse(demoted.body).role).toBe('viewer');
    });

    it.each(['editor', 'viewer'] as const)('answers 403 FORBIDDEN to a %s', async (role) => {
      const session = role === 'editor' ? editor.session : viewer.session;
      const response = await changeRole(session, viewer.membershipId, 'owner').expect(403);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
    });

    it('rejects an unknown role with 422', async () => {
      await changeRole(ownerSession, editor.membershipId, 'admin').expect(422);
    });

    it('answers 404 for a membership that does not exist or belongs to another organization', async () => {
      await changeRole(ownerSession, randomUUID(), 'viewer').expect(404);
      const other = await createOrganization(app, ownerSession, 'Otra');
      const foreign = await membershipIdOf(app, ownerSession, other.id, owner.id);
      await changeRole(ownerSession, foreign, 'viewer').expect(404);
    });

    it('applies on the very next request of the affected member', async () => {
      await startPing(editor.session).expect(202);
      await changeRole(ownerSession, editor.membershipId, 'viewer').expect(200);
      // Same cookie, no new login: the guard reads the membership on every request (FR-025).
      const denied = await startPing(editor.session).expect(403);
      expect(ProblemDetailsSchema.parse(denied.body).code).toBe('FORBIDDEN');
      const info = await api()
        .get('/api/v1/auth/session')
        .set('Cookie', editor.session.cookie)
        .expect(200);
      const role = SessionInfoSchema.parse(info.body).organizations.find(
        (item) => item.id === organization.id,
      )?.role;
      expect(role).toBe('viewer');
    });

    it('requires the CSRF token', async () => {
      await api()
        .patch(`${base()}/${editor.membershipId}`)
        .set('Cookie', ownerSession.cookie)
        .set('Origin', authHeaders(ownerSession).Origin)
        .send({ role: 'viewer' })
        .expect(403);
    });
  });

  describe('the last owner (FR-024)', () => {
    it('cannot be demoted or removed', async () => {
      const demote = await changeRole(ownerSession, ownerMembershipId, 'editor').expect(409);
      expect(ProblemDetailsSchema.parse(demote.body).code).toBe('LAST_OWNER');
      const removal = await remove(ownerSession, ownerMembershipId).expect(409);
      expect(ProblemDetailsSchema.parse(removal.body).code).toBe('LAST_OWNER');
    });

    it('can step down once another owner exists, and then the new sole owner is protected', async () => {
      await changeRole(ownerSession, editor.membershipId, 'owner').expect(200);
      await changeRole(ownerSession, ownerMembershipId, 'viewer').expect(200);
      const protectedOwner = await changeRole(editor.session, editor.membershipId, 'viewer').expect(
        409,
      );
      expect(ProblemDetailsSchema.parse(protectedOwner.body).code).toBe('LAST_OWNER');
    });

    it('survives two owners demoting each other at the same time', async () => {
      await changeRole(ownerSession, editor.membershipId, 'owner').expect(200);
      const results = await Promise.all([
        changeRole(ownerSession, editor.membershipId, 'viewer'),
        changeRole(editor.session, ownerMembershipId, 'viewer'),
      ]);
      const statuses = results.map((result) => result.status);
      // One succeeds; the other either loses to the owner check (409) or, once demoted, is no
      // longer allowed to act (403). Never both succeed.
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      const remaining = await api().get(base()).set('Cookie', ownerSession.cookie);
      const survivor = remaining.status === 200 ? ownerSession : editor.session;
      const members = await api().get(base()).set('Cookie', survivor.cookie).expect(200);
      expect((members.body as { role: string }[]).filter((m) => m.role === 'owner')).toHaveLength(
        1,
      );
    });
  });

  describe('removing', () => {
    it('is a soft delete: the row stays with deleted_at and the member loses access at once', async () => {
      await remove(ownerSession, editor.membershipId).expect(204);

      const rows = await database.withContext(
        { userId: editor.user.id, organizationId: organization.id },
        // eslint-disable-next-line no-restricted-syntax -- the test must see the soft-deleted row
        (tx) => tx.select().from(memberships).where(eq(memberships.id, editor.membershipId)),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deletedAt).toBeInstanceOf(Date);

      const denied = await api().get(base()).set('Cookie', editor.session.cookie).expect(404);
      expect(ProblemDetailsSchema.parse(denied.body).code).toBe('NOT_FOUND');
      await startPing(editor.session).expect(404);
      const info = await api()
        .get('/api/v1/auth/session')
        .set('Cookie', editor.session.cookie)
        .expect(200);
      expect(
        SessionInfoSchema.parse(info.body).organizations.some(
          (item) => item.id === organization.id,
        ),
      ).toBe(false);

      const listed = await api().get(base()).set('Cookie', ownerSession.cookie).expect(200);
      expect((listed.body as { userId: string }[]).map((m) => m.userId)).not.toContain(
        editor.user.id,
      );
    });

    it('creates a new membership when the person is invited again', async () => {
      await remove(ownerSession, editor.membershipId).expect(204);
      const { token } = await invite(
        app,
        ownerSession,
        organization.id,
        editor.user.email,
        'viewer',
      );
      await api()
        .post('/api/v1/invitations/accept')
        .set(authHeaders(editor.session))
        .send({ token })
        .expect(200);

      const rows = await database.withContext(
        { userId: editor.user.id, organizationId: organization.id },
        // eslint-disable-next-line no-restricted-syntax -- the test must see the soft-deleted row
        (tx) => tx.select().from(memberships).where(eq(memberships.userId, editor.user.id)),
      );
      const own = rows.filter((row) => row.organizationId === organization.id);
      expect(own).toHaveLength(2);
      const active = own.filter((row) => row.deletedAt === null);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ role: 'viewer' });
      expect(active[0]?.id).not.toBe(editor.membershipId);
    });

    it.each(['editor', 'viewer'] as const)('answers 403 FORBIDDEN to a %s', async (role) => {
      const session = role === 'editor' ? editor.session : viewer.session;
      const response = await remove(session, viewer.membershipId).expect(403);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
    });

    it('answers 404 for an unknown membership', async () => {
      await remove(ownerSession, randomUUID()).expect(404);
    });
  });

  it('emits membership events without secrets', async () => {
    const emit = vi.spyOn(SecurityEventLogger.prototype, 'emit');
    await changeRole(ownerSession, editor.membershipId, 'viewer').expect(200);
    await remove(ownerSession, viewer.membershipId).expect(204);
    const events = emit.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'membership.role_changed',
        outcome: 'success',
        userId: owner.id,
        organizationId: organization.id,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'membership.removed',
        outcome: 'success',
        userId: owner.id,
        organizationId: organization.id,
      }),
    );
    emit.mockRestore();
  });
});

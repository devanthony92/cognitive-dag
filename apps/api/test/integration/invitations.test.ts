import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvitationPreviewSchema,
  InvitationSchema,
  OrganizationSummarySchema,
  ProblemDetailsSchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import {
  active,
  and,
  eq,
  invitations,
  memberships,
  sql,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  emailsTo,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  STRONG_PASSWORD,
  tokenFrom,
  uniqueEmail,
  waitForEmails,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import { acceptInvitation, createOrganization, invite, joinAs, sha256Hex } from './members-helpers';

describe('invitations (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let owner: TestUser;
  let ownerSession: LoggedIn;
  let organization: OrganizationSummary;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    owner = await createVerifiedUser(app, database, 'invite-owner');
    ownerSession = await loginAs(app, owner);
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(async () => {
    await resetRateLimits();
    organization = await createOrganization(app, ownerSession, 'Laboratorio Ñandú');
  });

  const api = () => request(httpServer(app));
  const path = () => `/api/v1/organizations/${organization.id}/invitations`;
  const preview = (token: string) => api().post('/api/v1/invitations/preview').send({ token });

  const rowOf = (token: string) =>
    database.withContext({ lookupTokenHash: sha256Hex(token) }, async (tx) => {
      const [row] = await tx.select().from(invitations);
      return row!;
    });

  async function expireInvitation(token: string): Promise<void> {
    await database.withContext({ lookupTokenHash: sha256Hex(token) }, (tx) =>
      tx.update(invitations).set({ expiresAt: sql`now() - interval '1 second'` }),
    );
  }

  describe('sending', () => {
    it('creates a single-use invitation of 7 days and mails the link', async () => {
      const email = uniqueEmail('guest');
      const response = await api().post(path()).set(authHeaders(ownerSession)).send({
        email: email.toUpperCase(),
        role: 'editor',
      });
      expect(response.status).toBe(201);
      const created = InvitationSchema.parse(response.body);
      expect(created).toMatchObject({ email, role: 'editor' });
      const days = (Date.parse(created.expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);

      const [mail] = await waitForEmails(email);
      expect(mail!.text).toContain('Laboratorio Ñandú');
      expect(mail!.headers['X-Correlation-Id']).toBeDefined();
      const token = tokenFrom(mail!);
      const row = await rowOf(token);
      expect(row.tokenHash.toString('hex')).toBe(sha256Hex(token));
      expect(row).toMatchObject({ status: 'pending', email, role: 'editor' });
    });

    it.each(['editor', 'viewer'] as const)('answers 403 FORBIDDEN to a %s', async (role) => {
      const member = await joinAs(app, database, ownerSession, organization.id, role);
      const calls = [
        () =>
          api().post(path()).set(authHeaders(member.session)).send({ email: uniqueEmail(), role }),
        () => api().get(path()).set('Cookie', member.session.cookie),
        () =>
          api()
            .delete(`${path()}/0192f0a0-0000-7000-8000-000000000001`)
            .set(authHeaders(member.session)),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(403);
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
      }
    });

    it('validates the email and the role', async () => {
      const send = (body: Record<string, unknown>) =>
        api().post(path()).set(authHeaders(ownerSession)).send(body);
      await send({ email: 'no-es-un-email', role: 'viewer' }).expect(422);
      await send({ email: uniqueEmail(), role: 'admin' }).expect(422);
      await send({ email: uniqueEmail() }).expect(422);
    });

    it('rejects the email of a current member with 409 ALREADY_MEMBER', async () => {
      const member = await joinAs(app, database, ownerSession, organization.id, 'viewer');
      const response = await api()
        .post(path())
        .set(authHeaders(ownerSession))
        .send({ email: member.user.email, role: 'editor' })
        .expect(409);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('ALREADY_MEMBER');
      // The owner's own address too.
      await api()
        .post(path())
        .set(authHeaders(ownerSession))
        .send({ email: owner.email, role: 'viewer' })
        .expect(409);
    });

    it('replaces the pending invitation of the same email: only the newest link works', async () => {
      const email = uniqueEmail('again');
      const first = await invite(app, ownerSession, organization.id, email, 'viewer');
      const second = await invite(app, ownerSession, organization.id, email, 'editor');
      expect(second.token).not.toBe(first.token);

      await preview(first.token).expect(422);
      const current = await preview(second.token).expect(200);
      expect(InvitationPreviewSchema.parse(current.body).role).toBe('editor');

      const listed = await api().get(path()).set('Cookie', ownerSession.cookie).expect(200);
      expect(
        (listed.body as { email: string }[]).filter((item) => item.email === email),
      ).toHaveLength(1);
    });

    it('limits how many invitations an organization can send per hour', async () => {
      for (let i = 0; i < 20; i += 1) {
        await api()
          .post(path())
          .set(authHeaders(ownerSession))
          .send({ email: uniqueEmail('bulk'), role: 'viewer' })
          .expect(201);
      }
      const blocked = await api()
        .post(path())
        .set(authHeaders(ownerSession))
        .send({ email: uniqueEmail('bulk'), role: 'viewer' })
        .expect(429);
      expect(ProblemDetailsSchema.parse(blocked.body).retryAfterSeconds).toBeGreaterThan(0);
    });

    it('requires the CSRF token', async () => {
      await api()
        .post(path())
        .set('Cookie', ownerSession.cookie)
        .set('Origin', authHeaders(ownerSession).Origin)
        .send({ email: uniqueEmail(), role: 'viewer' })
        .expect(403);
    });
  });

  describe('listing and revoking', () => {
    it('lists only pending, unexpired invitations to the owner', async () => {
      const pending = await invite(app, ownerSession, organization.id, uniqueEmail('p'), 'viewer');
      const expired = await invite(app, ownerSession, organization.id, uniqueEmail('x'), 'viewer');
      const revoked = await invite(app, ownerSession, organization.id, uniqueEmail('r'), 'viewer');
      await expireInvitation(expired.token);
      await api()
        .delete(`${path()}/${revoked.invitation.id}`)
        .set(authHeaders(ownerSession))
        .expect(204);

      const listed = await api().get(path()).set('Cookie', ownerSession.cookie).expect(200);
      expect((listed.body as { id: string }[]).map((item) => item.id)).toEqual([
        pending.invitation.id,
      ]);
    });

    it('revokes: the link stops working and the event is logged', async () => {
      const emit = vi.spyOn(SecurityEventLogger.prototype, 'emit');
      const { invitation, token } = await invite(
        app,
        ownerSession,
        organization.id,
        uniqueEmail('rev'),
        'viewer',
      );
      await api().delete(`${path()}/${invitation.id}`).set(authHeaders(ownerSession)).expect(204);

      await preview(token).expect(422);
      expect((await rowOf(token)).status).toBe('revoked');
      expect(emit.mock.calls.map(([event]) => event)).toContainEqual(
        expect.objectContaining({
          event: 'invitation.revoked',
          outcome: 'success',
          userId: owner.id,
          organizationId: organization.id,
        }),
      );
      emit.mockRestore();
    });

    it('answers 404 when revoking an unknown, already revoked or foreign invitation', async () => {
      const mine = await invite(app, ownerSession, organization.id, uniqueEmail('m'), 'viewer');
      const otherOrg = await createOrganization(app, ownerSession, 'Otra organización');
      await api()
        .delete(`/api/v1/organizations/${otherOrg.id}/invitations/${mine.invitation.id}`)
        .set(authHeaders(ownerSession))
        .expect(404);
      await api()
        .delete(`${path()}/${mine.invitation.id}`)
        .set(authHeaders(ownerSession))
        .expect(204);
      await api()
        .delete(`${path()}/${mine.invitation.id}`)
        .set(authHeaders(ownerSession))
        .expect(404);
    });
  });

  describe('preview (no session)', () => {
    it('shows only the organization name, the invited email and the role', async () => {
      const email = uniqueEmail('prev');
      const { token } = await invite(app, ownerSession, organization.id, email, 'viewer');
      const response = await preview(token).expect(200);
      expect(response.body).toEqual({
        organizationName: 'Laboratorio Ñandú',
        email,
        role: 'viewer',
      });
    });

    it('answers 422 TOKEN_INVALID for unknown, expired and accepted links, the same way', async () => {
      const unknown = await preview('A'.repeat(43)).expect(422);
      expect(ProblemDetailsSchema.parse(unknown.body).code).toBe('TOKEN_INVALID');

      const expired = await invite(app, ownerSession, organization.id, uniqueEmail('e'), 'viewer');
      await expireInvitation(expired.token);
      const expiredResponse = await preview(expired.token).expect(422);
      expect(expiredResponse.body).toMatchObject({
        code: 'TOKEN_INVALID',
        detail: ProblemDetailsSchema.parse(unknown.body).detail,
      });

      const guest = await createVerifiedUser(app, database, 'prev-accepted');
      const accepted = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      await acceptInvitation(app, await loginAs(app, guest), accepted.token).expect(200);
      await preview(accepted.token).expect(422);
    });

    it('does not take the token from the URL', async () => {
      const { token } = await invite(
        app,
        ownerSession,
        organization.id,
        uniqueEmail('q'),
        'viewer',
      );
      await api().post(`/api/v1/invitations/preview?token=${token}`).send({}).expect(422);
    });

    it('rejects a malformed token with 422', async () => {
      await preview('short').expect(422);
    });
  });

  describe('accepting', () => {
    it('makes the invited, signed-in person a member with the invited role', async () => {
      const guest = await createVerifiedUser(app, database, 'guest');
      const { token } = await invite(app, ownerSession, organization.id, guest.email, 'editor');
      const session = await loginAs(app, guest);

      const response = await acceptInvitation(app, session, token).expect(200);
      expect(OrganizationSummarySchema.parse(response.body)).toEqual({
        id: organization.id,
        name: 'Laboratorio Ñandú',
        role: 'editor',
        isPersonal: false,
      });

      const members = await api()
        .get(`/api/v1/organizations/${organization.id}/members`)
        .set('Cookie', session.cookie)
        .expect(200);
      expect((members.body as { userId: string }[]).map((m) => m.userId)).toContain(guest.id);
      const row = await rowOf(token);
      expect(row).toMatchObject({ status: 'accepted', acceptedBy: guest.id });
      expect(row.acceptedAt).toBeInstanceOf(Date);
    });

    it('is single use', async () => {
      const guest = await createVerifiedUser(app, database, 'once');
      const { token } = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      const session = await loginAs(app, guest);
      await acceptInvitation(app, session, token).expect(200);
      const again = await acceptInvitation(app, session, token).expect(422);
      expect(ProblemDetailsSchema.parse(again.body).code).toBe('TOKEN_INVALID');
    });

    it('is bound to the invited email: another account gets 403 and the link stays valid', async () => {
      const guest = await createVerifiedUser(app, database, 'bound');
      const intruder = await createVerifiedUser(app, database, 'intruder');
      const { token } = await invite(app, ownerSession, organization.id, guest.email, 'viewer');

      const denied = await acceptInvitation(app, await loginAs(app, intruder), token).expect(403);
      expect(ProblemDetailsSchema.parse(denied.body).code).toBe('FORBIDDEN');
      expect((await rowOf(token)).status).toBe('pending');
      const memberRows = await database.withContext(
        { userId: intruder.id, organizationId: organization.id },
        (tx) =>
          active.memberships(
            tx,
            and(
              eq(memberships.userId, intruder.id),
              eq(memberships.organizationId, organization.id),
            ),
          ),
      );
      expect(memberRows).toHaveLength(0);

      await acceptInvitation(app, await loginAs(app, guest), token).expect(200);
    });

    it('rejects an expired or revoked link with 422', async () => {
      const guest = await createVerifiedUser(app, database, 'late');
      const session = await loginAs(app, guest);
      const expired = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      await expireInvitation(expired.token);
      await acceptInvitation(app, session, expired.token).expect(422);

      const revoked = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      await api()
        .delete(`${path()}/${revoked.invitation.id}`)
        .set(authHeaders(ownerSession))
        .expect(204);
      await acceptInvitation(app, session, revoked.token).expect(422);
    });

    it('answers 409 ALREADY_MEMBER when the person joined by other means in the meantime', async () => {
      const guest = await createVerifiedUser(app, database, 'dup');
      const { token } = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      await database.withContext({ userId: guest.id, organizationId: organization.id }, (tx) =>
        tx.insert(memberships).values({
          organizationId: organization.id,
          userId: guest.id,
          role: 'editor',
        }),
      );
      const response = await acceptInvitation(app, await loginAs(app, guest), token).expect(409);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('ALREADY_MEMBER');
    });

    it('needs a session and the CSRF token', async () => {
      const guest = await createVerifiedUser(app, database, 'csrf');
      const { token } = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
      await api().post('/api/v1/invitations/accept').send({ token }).expect(401);
      const session = await loginAs(app, guest);
      await api()
        .post('/api/v1/invitations/accept')
        .set('Cookie', session.cookie)
        .set('Origin', authHeaders(session).Origin)
        .send({ token })
        .expect(403);
    });

    it('lets a person without an account register from the link and join after verifying', async () => {
      const email = uniqueEmail('newcomer');
      const { token } = await invite(app, ownerSession, organization.id, email, 'editor');

      // The link works without a session and names the invited email.
      expect(InvitationPreviewSchema.parse((await preview(token).expect(200)).body).email).toBe(
        email,
      );

      await api()
        .post('/api/v1/auth/register')
        .send({ name: 'Recién llegada', email, password: STRONG_PASSWORD })
        .expect(202);
      const mails = await waitForEmails(email, 2);
      const verification = mails.find((mail) => /Verifica/.test(mail.subject))!;
      await api()
        .post('/api/v1/auth/verify-email')
        .send({ token: tokenFrom(verification) })
        .expect(204);

      const session = await loginAs(app, { email, password: STRONG_PASSWORD });
      const response = await acceptInvitation(app, session, token).expect(200);
      expect(OrganizationSummarySchema.parse(response.body)).toMatchObject({
        id: organization.id,
        role: 'editor',
      });
      expect(await emailsTo(email)).not.toHaveLength(0);
    });
  });

  it('emits invitation.sent and invitation.accepted without tokens', async () => {
    const emit = vi.spyOn(SecurityEventLogger.prototype, 'emit');
    const guest = await createVerifiedUser(app, database, 'events');
    const { token } = await invite(app, ownerSession, organization.id, guest.email, 'viewer');
    await acceptInvitation(app, await loginAs(app, guest), token).expect(200);
    const events = emit.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'invitation.sent',
        outcome: 'success',
        userId: owner.id,
        organizationId: organization.id,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'invitation.accepted',
        outcome: 'success',
        userId: guest.id,
        organizationId: organization.id,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(token);
    emit.mockRestore();
  });
});

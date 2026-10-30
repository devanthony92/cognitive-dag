import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@cognitive-dag/db';
import {
  SECURITY_EVENTS,
  SecurityEventLogger,
  type SecurityEventType,
} from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  emailsTo,
  loginAs,
  openDatabase,
  resetRateLimits,
  SESSION_COOKIE,
  startIdentityApp,
  STRONG_PASSWORD,
  tokenFrom,
  uniqueEmail,
  waitForEmailWithSubject,
} from './identity-helpers';
import { createOrganization, invite, joinAs } from './members-helpers';
import { uniqueTaskQueue } from './ping-helpers';
import { DAG_FLAGS, validDefinition } from './workflows-helpers';

const ALLOWED_KEYS = new Set(['event', 'outcome', 'userId', 'organizationId', 'ip']);

describe('security events (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;

  beforeAll(async () => {
    app = await startIdentityApp(DAG_FLAGS, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
    database = openDatabase();
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const api = () => request(httpServer(app));

  it('emits every FR-026 event with the FR-027 fields and no secrets (SC-007)', async () => {
    const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
    const secrets: string[] = [STRONG_PASSWORD];

    // user.registered (success and duplicate), user.email_verified
    const email = uniqueEmail('events');
    await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Eventos', email, password: STRONG_PASSWORD })
      .expect(202);
    await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Eventos', email, password: STRONG_PASSWORD })
      .expect(202);
    // The duplicate registration also mails this address, and either mail may arrive first.
    const verification = await waitForEmailWithSubject(email, /Verifica/);
    const verificationToken = tokenFrom(verification);
    secrets.push(verificationToken);
    await api().post('/api/v1/auth/verify-email').send({ token: verificationToken }).expect(204);

    // auth.login_failed, auth.login_succeeded, auth.logout
    await api().post('/api/v1/auth/login').send({ email, password: 'no es la clave' }).expect(401);
    const session = await loginAs(app, { email, password: STRONG_PASSWORD });
    secrets.push(session.cookie.slice(SESSION_COOKIE.length + 1), session.csrfToken);
    await api().post('/api/v1/auth/logout').set(authHeaders(session)).expect(204);

    // auth.password_reset_requested / _completed
    await api().post('/api/v1/auth/password-reset/request').send({ email }).expect(202);
    const reset = await (async () => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const found = (await emailsTo(email)).filter((mail) => /Restablece/.test(mail.subject));
        if (found.length > 0) return found[0]!;
        if (Date.now() > deadline) throw new Error('No reset email in time');
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    })();
    const resetToken = tokenFrom(reset);
    secrets.push(resetToken);
    const newPassword = 'una-clave-recien-hecha';
    secrets.push(newPassword);
    await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: resetToken, password: newPassword })
      .expect(204);

    // auth.password_changed
    const again = await loginAs(app, { email, password: newPassword });
    const changed = 'otra-clave-todavia-mas';
    secrets.push(changed);
    await api()
      .post('/api/v1/auth/password/change')
      .set(authHeaders(again))
      .send({ currentPassword: newPassword, newPassword: changed })
      .expect(204);

    // org.created, org.renamed, invitation.sent / accepted / revoked,
    // membership.role_changed / removed
    const owner = await createVerifiedUser(app, database, 'events-owner');
    const ownerSession = await loginAs(app, owner);
    const organization = await createOrganization(app, ownerSession, 'Eventos S.A.');
    await api()
      .patch(`/api/v1/organizations/${organization.id}`)
      .set(authHeaders(ownerSession))
      .send({ name: 'Eventos Renombrada' })
      .expect(200);
    const member = await joinAs(app, database, ownerSession, organization.id, 'viewer');
    const pending = await invite(app, ownerSession, organization.id, uniqueEmail('p'), 'viewer');
    secrets.push(pending.token);
    await api()
      .delete(`/api/v1/organizations/${organization.id}/invitations/${pending.invitation.id}`)
      .set(authHeaders(ownerSession))
      .expect(204);
    await api()
      .patch(`/api/v1/organizations/${organization.id}/members/${member.membershipId}`)
      .set(authHeaders(ownerSession))
      .send({ role: 'editor' })
      .expect(200);
    await api()
      .delete(`/api/v1/organizations/${organization.id}/members/${member.membershipId}`)
      .set(authHeaders(ownerSession))
      .expect(204);

    // workflow.created, workflow.published, workflow.version_activated, workflow.archived
    const workflowsUrl = `/api/v1/organizations/${organization.id}/workflows`;
    const workflow = await api()
      .post(workflowsUrl)
      .set(authHeaders(ownerSession))
      .send({ name: 'Eventos de workflow' })
      .expect(201);
    const workflowId = (workflow.body as { id: string }).id;
    await api()
      .put(`${workflowsUrl}/${workflowId}/draft`)
      .set(authHeaders(ownerSession))
      .set('If-Match', '"1"')
      .send({ definition: validDefinition() })
      .expect(200);
    await api()
      .post(`${workflowsUrl}/${workflowId}/versions`)
      .set(authHeaders(ownerSession))
      .set('If-Match', '"2"')
      .expect(201);
    await api()
      .post(`${workflowsUrl}/${workflowId}/versions/1/activate`)
      .set(authHeaders(ownerSession))
      .expect(200);
    await api().delete(`${workflowsUrl}/${workflowId}`).set(authHeaders(ownerSession)).expect(204);

    // auth.rate_limited
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/v1/auth/login').send({ email: owner.email, password: 'no-es-esa' });
    }
    await api()
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'no-es-esa' })
      .expect(429);

    const events = emit.mock.calls.map(([event]) => event);
    emit.mockRestore();

    const seen = new Set<SecurityEventType>(events.map((event) => event.event));
    expect([...SECURITY_EVENTS].filter((type) => !seen.has(type))).toEqual([]);

    for (const event of events) {
      expect(Object.keys(event).every((key) => ALLOWED_KEYS.has(key))).toBe(true);
      expect(['success', 'failure', 'blocked']).toContain(event.outcome);
      expect(event.ip).toEqual(expect.any(String));
    }
    const serialized = JSON.stringify(events);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });
});

import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Invitation, OrganizationSummary, Role } from '@cognitive-dag/contracts';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  emailsTo,
  loginAs,
  tokenFrom,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import type { DatabaseClient } from '@cognitive-dag/db';

export const sha256Hex = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export async function createOrganization(
  app: INestApplication,
  session: LoggedIn,
  name = 'Equipo',
): Promise<OrganizationSummary> {
  const response = await request(httpServer(app))
    .post('/api/v1/organizations')
    .set(authHeaders(session))
    .send({ name })
    .expect(201);
  return response.body as OrganizationSummary;
}

/** Owner invites `email`; returns the invitation and the token read from the captured email. */
export async function invite(
  app: INestApplication,
  owner: LoggedIn,
  organizationId: string,
  email: string,
  role: Role,
): Promise<{ invitation: Invitation; token: string }> {
  const before = (await invitationEmails(email)).length;
  const response = await request(httpServer(app))
    .post(`/api/v1/organizations/${organizationId}/invitations`)
    .set(authHeaders(owner))
    .send({ email, role })
    .expect(201);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mails = await invitationEmails(email);
    // Mail goes out after the commit; the newest message is the one just sent.
    if (mails.length > before) {
      return {
        invitation: response.body as Invitation,
        token: tokenFrom(mails[mails.length - 1]!),
      };
    }
    if (Date.now() > deadline) throw new Error(`No invitation email for ${email} in time`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const invitationEmails = async (address: string) =>
  (await emailsTo(address)).filter((mail) => /te invitó/.test(mail.subject));

export const acceptInvitation = (app: INestApplication, session: LoggedIn, token: string) =>
  request(httpServer(app)).post('/api/v1/invitations/accept').set(authHeaders(session)).send({
    token,
  });

export interface Joined {
  user: TestUser;
  session: LoggedIn;
}

/** A verified user who joins the organization with `role` through the real invitation flow. */
export async function joinAs(
  app: INestApplication,
  database: DatabaseClient,
  owner: LoggedIn,
  organizationId: string,
  role: Role,
  label = role,
): Promise<Joined & { membershipId: string }> {
  const user = await createVerifiedUser(app, database, label);
  const { token } = await invite(app, owner, organizationId, user.email, role);
  const session = await loginAs(app, user);
  await acceptInvitation(app, session, token).expect(200);
  const fresh = await loginAs(app, user);
  const membershipId = await membershipIdOf(app, owner, organizationId, user.id);
  return { user, session: fresh, membershipId };
}

export async function membershipIdOf(
  app: INestApplication,
  owner: LoggedIn,
  organizationId: string,
  userId: string,
): Promise<string> {
  const response = await request(httpServer(app))
    .get(`/api/v1/organizations/${organizationId}/members`)
    .set('Cookie', owner.cookie)
    .expect(200);
  const member = (response.body as { membershipId: string; userId: string }[]).find(
    (item) => item.userId === userId,
  );
  if (!member) throw new Error(`User ${userId} is not a member of ${organizationId}`);
  return member.membershipId;
}

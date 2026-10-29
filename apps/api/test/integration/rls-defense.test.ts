import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrganizationSummary } from '@cognitive-dag/contracts';
import { active, eq, organizations, type DatabaseClient } from '@cognitive-dag/db';
import { AppModule } from '../../src/app.module';
import { OrganizationGuard } from '../../src/organizations/organization.guard';
import { httpServer, testConfig } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  IDENTITY_FLAGS,
  loginAs,
  openDatabase,
  resetRateLimits,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';
import { TenantProbeModule } from './support/tenant-probe';

/**
 * SC-003: the application layer (the organization guard) is switched off and the code under test
 * has no organization filter. Reads and writes to another organization must still fail, because
 * PostgreSQL row-level security decides, not the application.
 */
describe('RLS defence with the organization guard disabled (requires docker compose up)', () => {
  let guardOff: INestApplication;
  let guardOn: INestApplication;
  let database: DatabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceSession: LoggedIn;
  let bobSession: LoggedIn;
  let aliceOrg: OrganizationSummary;
  let bobOrg: OrganizationSummary;

  async function startProbeApp(disableGuard: boolean): Promise<INestApplication> {
    const builder = Test.createTestingModule({
      imports: [
        AppModule.forRoot({ ...testConfig(), FEATURE_FLAGS: IDENTITY_FLAGS }),
        TenantProbeModule,
      ],
    });
    if (disableGuard) {
      builder.overrideGuard(OrganizationGuard).useValue({ canActivate: () => true });
    }
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    return app;
  }

  beforeAll(async () => {
    guardOff = await startProbeApp(true);
    guardOn = await startProbeApp(false);
    database = openDatabase();
    await resetRateLimits();
    alice = await createVerifiedUser(guardOff, database, 'rls-a');
    bob = await createVerifiedUser(guardOff, database, 'rls-b');
    aliceSession = await loginAs(guardOff, alice);
    bobSession = await loginAs(guardOff, bob);
    aliceOrg = aliceSession.body.organizations[0]!;
    bobOrg = bobSession.body.organizations[0]!;
  });

  afterAll(async () => {
    await guardOff.close();
    await guardOn.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const probe = (app: INestApplication, organizationId: string, path: string) =>
    request(httpServer(app)).get(`/api/v1/organizations/${organizationId}/probe/${path}`);

  describe('guard off: the context carries the user but no organization', () => {
    it('reads of another organization return nothing', async () => {
      const members = await probe(guardOff, bobOrg.id, 'memberships')
        .set('Cookie', aliceSession.cookie)
        .expect(200);
      expect((members.body as { organizationIds: string[] }).organizationIds).toEqual([
        aliceOrg.id,
      ]);

      const orgs = await probe(guardOff, bobOrg.id, 'organizations')
        .set('Cookie', aliceSession.cookie)
        .expect(200);
      expect((orgs.body as { organizationIds: string[] }).organizationIds).toEqual([aliceOrg.id]);
    });

    it('a write that targets another organization is rejected', async () => {
      const response = await request(httpServer(guardOff))
        .post(`/api/v1/organizations/${bobOrg.id}/probe/membership?target=${bobOrg.id}`)
        .set(authHeaders(aliceSession))
        .expect(201);
      expect(response.body).toEqual({ written: false });
    });

    it('an update of another organization changes nothing', async () => {
      const response = await request(httpServer(guardOff))
        .patch(`/api/v1/organizations/${bobOrg.id}/probe/organization?target=${bobOrg.id}`)
        .set(authHeaders(aliceSession))
        .expect(200);
      expect(response.body).toEqual({ updated: 0 });
      await expectOrganizationName(bobOrg.id, bob, bobOrg.name);
    });
  });

  describe("guard on: the context is Alice's organization, the code is still careless", () => {
    it('reads with no organization filter see only her own organization', async () => {
      const members = await probe(guardOn, aliceOrg.id, 'memberships')
        .set('Cookie', aliceSession.cookie)
        .expect(200);
      const ids = (members.body as { organizationIds: string[] }).organizationIds;
      expect(ids).toContain(aliceOrg.id);
      expect(ids).not.toContain(bobOrg.id);
    });

    it('a membership written into another organization is rejected', async () => {
      const response = await request(httpServer(guardOn))
        .post(`/api/v1/organizations/${aliceOrg.id}/probe/membership?target=${bobOrg.id}`)
        .set(authHeaders(aliceSession))
        .expect(201);
      expect(response.body).toEqual({ written: false });
    });

    it('an update aimed at another organization changes nothing', async () => {
      const response = await request(httpServer(guardOn))
        .patch(`/api/v1/organizations/${aliceOrg.id}/probe/organization?target=${bobOrg.id}`)
        .set(authHeaders(aliceSession))
        .expect(200);
      expect(response.body).toEqual({ updated: 0 });
      await expectOrganizationName(bobOrg.id, bob, bobOrg.name);
    });

    it('the guard itself still answers 404 for a non-member path', async () => {
      await probe(guardOn, bobOrg.id, 'memberships').set('Cookie', aliceSession.cookie).expect(404);
    });
  });

  it('the probe is not a no-op: the same write inside the own organization works', async () => {
    const response = await request(httpServer(guardOn))
      .patch(`/api/v1/organizations/${aliceOrg.id}/probe/organization?target=${aliceOrg.id}`)
      .set(authHeaders(aliceSession))
      .expect(200);
    expect(response.body).toEqual({ updated: 1 });
  });

  async function expectOrganizationName(id: string, owner: TestUser, name: string): Promise<void> {
    const [row] = await database.withContext({ userId: owner.id }, (tx) =>
      active.organizations(tx, eq(organizations.id, id)),
    );
    expect(row?.name).toBe(name);
  }
});

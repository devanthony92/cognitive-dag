import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@cognitive-dag/contracts';
import type { AuthSession } from '../../src/auth/session.service';
import type { MembershipService } from '../../src/organizations/membership.service';
import { OrganizationGuard } from '../../src/organizations/organization.guard';
import { RequiredRoles } from '../../src/organizations/required-roles.decorator';

const USER_ID = '0192f0a0-0000-7000-8000-000000000001';
const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';

class AnyMember {
  handler(): void {}
}

class OwnersOnly {
  @RequiredRoles('owner')
  handler(): void {}
}

class EditorsAndOwners {
  @RequiredRoles('owner', 'editor')
  handler(): void {}
}

function contextFor(
  target: new () => { handler(): void },
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (target.prototype as { handler: () => void }).handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

describe('OrganizationGuard', () => {
  let find: ReturnType<typeof vi.fn>;
  let guard: OrganizationGuard;

  const auth: AuthSession = {
    sessionId: 's1',
    userId: USER_ID,
    tokenHash: 'ab',
    csrfTokenHash: Buffer.alloc(32),
    csrfToken: 'x'.repeat(43),
  };

  const member = (role: Role) => find.mockResolvedValue({ membershipId: 'm1', role });

  const request = (overrides: Record<string, unknown> = {}) => ({
    auth,
    params: { organizationId: ORG_ID },
    ...overrides,
  });

  beforeEach(() => {
    find = vi.fn();
    guard = new OrganizationGuard(new Reflector(), { find } as unknown as MembershipService);
  });

  it('lets an active member in and records the organization for the handler', async () => {
    member('viewer');
    const req = request();
    await expect(guard.canActivate(contextFor(AnyMember, req))).resolves.toBe(true);
    expect(find).toHaveBeenCalledWith(USER_ID, ORG_ID);
    expect(req).toMatchObject({
      tenant: { organizationId: ORG_ID, membershipId: 'm1', role: 'viewer' },
    });
  });

  it('answers 404 NOT_FOUND when there is no active membership (non-member or deleted)', async () => {
    find.mockResolvedValue(undefined);
    const req = request();
    await expect(guard.canActivate(contextFor(AnyMember, req))).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(req).not.toHaveProperty('tenant');
  });

  it('answers 404 without querying when the id is not a UUID', async () => {
    const req = request({ params: { organizationId: 'not-a-uuid' } });
    await expect(guard.canActivate(contextFor(AnyMember, req))).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(find).not.toHaveBeenCalled();
  });

  it('answers 401 when no session was resolved', async () => {
    const req = request({ auth: undefined });
    await expect(guard.canActivate(contextFor(AnyMember, req))).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(find).not.toHaveBeenCalled();
  });

  it.each<[Role, boolean]>([
    ['owner', true],
    ['editor', false],
    ['viewer', false],
  ])('owner-only route, role %s: allowed=%s', async (role, allowed) => {
    member(role);
    const outcome = guard.canActivate(contextFor(OwnersOnly, request()));
    if (allowed) await expect(outcome).resolves.toBe(true);
    else await expect(outcome).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it.each<[Role, boolean]>([
    ['owner', true],
    ['editor', true],
    ['viewer', false],
  ])('owner-or-editor route, role %s: allowed=%s', async (role, allowed) => {
    member(role);
    const outcome = guard.canActivate(contextFor(EditorsAndOwners, request()));
    if (allowed) await expect(outcome).resolves.toBe(true);
    else await expect(outcome).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('checks membership before role, so a non-member never learns the role rules', async () => {
    find.mockResolvedValue(undefined);
    await expect(guard.canActivate(contextFor(OwnersOnly, request()))).rejects.toMatchObject({
      status: 404,
    });
  });
});

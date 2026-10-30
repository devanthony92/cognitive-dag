import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@cognitive-dag/contracts';
import type { AuthSession } from '../../src/auth/session.service';
import { ForbiddenRoleException } from '../../src/common/errors/domain.exception';
import { InvitationsController } from '../../src/organizations/invitations.controller';
import { wouldLeaveNoOwner } from '../../src/organizations/member-rules';
import { MembersController } from '../../src/organizations/members.controller';
import type { MembershipService } from '../../src/organizations/membership.service';
import { OrganizationGuard } from '../../src/organizations/organization.guard';
import { REQUIRED_ROLES } from '../../src/organizations/required-roles.decorator';

const USER_ID = '0192f0a0-0000-7000-8000-000000000001';
const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';

const requiredRoles = (target: object, handler: string): Role[] | undefined =>
  Reflect.getMetadata(REQUIRED_ROLES, (target as Record<string, object>)[handler]!) as
    Role[] | undefined;

function contextFor(controller: new (...args: never[]) => object, handler: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        auth: { userId: USER_ID } as AuthSession,
        params: { organizationId: ORG_ID },
      }),
    }),
    getHandler: () => (controller.prototype as Record<string, () => void>)[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function guardFor(role: Role): OrganizationGuard {
  const find = vi.fn().mockResolvedValue({ membershipId: 'm1', role });
  return new OrganizationGuard(new Reflector(), { find } as unknown as MembershipService);
}

/** Every route that changes who belongs to an organization (FR-022). */
const OWNER_ONLY = [
  [MembersController, 'changeRole'],
  [MembersController, 'remove'],
  [InvitationsController, 'list'],
  [InvitationsController, 'create'],
  [InvitationsController, 'revoke'],
] as const;

describe('member and invitation permissions', () => {
  it.each(OWNER_ONLY)('%o.%s is declared for owners only', (controller, handler) => {
    expect(requiredRoles(controller.prototype, handler)).toEqual(['owner']);
  });

  it('lists members for any role', () => {
    expect(requiredRoles(MembersController.prototype, 'list')).toBeUndefined();
  });

  describe.each(OWNER_ONLY)('%o.%s through the organization guard', (controller, handler) => {
    it.each(['editor', 'viewer'] as const)('answers 403 FORBIDDEN to a %s', async (role) => {
      const attempt = guardFor(role).canActivate(contextFor(controller, handler));
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenRoleException);
      await expect(attempt).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it('lets an owner through', async () => {
      await expect(guardFor('owner').canActivate(contextFor(controller, handler))).resolves.toBe(
        true,
      );
    });
  });

  it.each(['editor', 'viewer'] as const)('a %s can still list the members', async (role) => {
    await expect(guardFor(role).canActivate(contextFor(MembersController, 'list'))).resolves.toBe(
      true,
    );
  });
});

describe('wouldLeaveNoOwner (FR-024)', () => {
  const members = (...roles: Role[]) =>
    roles.map((role, index) => ({ membershipId: `m${index}`, role }));

  it('is true when the only owner is demoted or removed', () => {
    const team = members('owner', 'editor');
    expect(wouldLeaveNoOwner(team, 'm0', { role: 'editor' })).toBe(true);
    expect(wouldLeaveNoOwner(team, 'm0', { role: 'viewer' })).toBe(true);
    expect(wouldLeaveNoOwner(team, 'm0', { remove: true })).toBe(true);
  });

  it('is false while another owner remains', () => {
    const team = members('owner', 'owner', 'viewer');
    expect(wouldLeaveNoOwner(team, 'm0', { role: 'editor' })).toBe(false);
    expect(wouldLeaveNoOwner(team, 'm0', { remove: true })).toBe(false);
  });

  it('is false when the change keeps the target an owner or the target is not one', () => {
    const team = members('owner', 'editor');
    expect(wouldLeaveNoOwner(team, 'm0', { role: 'owner' })).toBe(false);
    expect(wouldLeaveNoOwner(team, 'm1', { remove: true })).toBe(false);
    expect(wouldLeaveNoOwner(team, 'm1', { role: 'viewer' })).toBe(false);
  });

  it('is false for a membership that is not in the list', () => {
    expect(wouldLeaveNoOwner(members('owner'), 'missing', { remove: true })).toBe(false);
  });

  it('counts two owners demoted one after the other correctly', () => {
    const team = members('owner', 'owner');
    expect(wouldLeaveNoOwner(team, 'm0', { role: 'viewer' })).toBe(false);
    const after = [{ membershipId: 'm0', role: 'viewer' as Role }, team[1]!];
    expect(wouldLeaveNoOwner(after, 'm1', { role: 'viewer' })).toBe(true);
  });
});

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { Role } from '@cognitive-dag/contracts';
import type { AppRequest } from '../auth/request-context';
import {
  ForbiddenRoleException,
  ResourceNotFoundException,
  UnauthenticatedException,
} from '../common/errors/domain.exception';
import { MembershipService } from './membership.service';
import { REQUIRED_ROLES } from './required-roles.decorator';

const OrganizationIdSchema = z.uuid();

/**
 * First application layer of tenant isolation (FR-017, FR-018): on every request under
 * `/organizations/{organizationId}` the caller needs an active membership, and the route's role.
 * A non-member gets the same 404 as an organization that does not exist. The second layer is
 * row-level security, which `withContext` arms with the organization this guard accepted.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.auth) throw new UnauthenticatedException();

    const parsed = OrganizationIdSchema.safeParse(
      (request.params as Record<string, unknown> | undefined)?.organizationId,
    );
    if (!parsed.success) throw new ResourceNotFoundException();

    const membership = await this.memberships.find(request.auth.userId, parsed.data);
    if (!membership) throw new ResourceNotFoundException();

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(membership.role)) throw new ForbiddenRoleException();

    request.tenant = {
      organizationId: parsed.data,
      membershipId: membership.membershipId,
      role: membership.role,
    };
    return true;
  }
}

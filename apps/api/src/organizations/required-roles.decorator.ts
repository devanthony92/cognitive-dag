import { SetMetadata } from '@nestjs/common';
import type { Role } from '@cognitive-dag/contracts';

export const REQUIRED_ROLES = 'organizations:required-roles';

/** Roles allowed on a route under /organizations/{id}. Without it any active member may pass. */
export const RequiredRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

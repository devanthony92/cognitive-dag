import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ChangeMemberRoleRequestSchema,
  CreateInvitationRequestSchema,
  CreateOrganizationRequestSchema,
  RenameOrganizationRequestSchema,
} from '@cognitive-dag/contracts';

export class CreateOrganizationDto extends createZodDto(CreateOrganizationRequestSchema) {}
export class RenameOrganizationDto extends createZodDto(RenameOrganizationRequestSchema) {}
export class ChangeMemberRoleDto extends createZodDto(ChangeMemberRoleRequestSchema) {}
export class CreateInvitationDto extends createZodDto(CreateInvitationRequestSchema) {}

export class MembershipParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), membershipId: z.uuid() }),
) {}

export class InvitationParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), invitationId: z.uuid() }),
) {}

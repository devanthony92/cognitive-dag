import { z } from 'zod';
import { EmailSchema } from './primitives.js';

export const RoleSchema = z.enum(['owner', 'editor', 'viewer']);

export type Role = z.infer<typeof RoleSchema>;

export const OrganizationNameSchema = z
  .string()
  .trim()
  .min(1, 'Debe tener entre 1 y 100 caracteres.')
  .max(100, 'Debe tener entre 1 y 100 caracteres.');

export const OrganizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: RoleSchema,
  isPersonal: z.boolean(),
});

export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const CreateOrganizationRequestSchema = z.strictObject({
  name: OrganizationNameSchema,
});

export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>;

export const RenameOrganizationRequestSchema = z.strictObject({
  name: OrganizationNameSchema,
});

export type RenameOrganizationRequest = z.infer<typeof RenameOrganizationRequestSchema>;

export const CreateInvitationRequestSchema = z.strictObject({
  email: EmailSchema,
  role: RoleSchema,
});

export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const ChangeMemberRoleRequestSchema = z.strictObject({ role: RoleSchema });

export type ChangeMemberRoleRequest = z.infer<typeof ChangeMemberRoleRequestSchema>;

export const MemberSchema = z.object({
  membershipId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
});

export type Member = z.infer<typeof MemberSchema>;

export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: RoleSchema,
  expiresAt: z.iso.datetime(),
});

export type Invitation = z.infer<typeof InvitationSchema>;

/** What a person sees before accepting: the minimum, never ids (FR-023). */
export const InvitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: RoleSchema,
});

export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

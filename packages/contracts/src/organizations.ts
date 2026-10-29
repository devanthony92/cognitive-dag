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

export const CreateInvitationRequestSchema = z.strictObject({
  email: EmailSchema,
  role: RoleSchema,
});

export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

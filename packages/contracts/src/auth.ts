import { z } from 'zod';
import { EmailSchema, OpaqueTokenSchema } from './primitives.js';
import { OrganizationSummarySchema } from './organizations.js';

export const CSRF_HEADER = 'X-CSRF-Token';

/** 32 random bytes as unpadded base64url: opaque tokens in emails and bodies (FR-031). */
export const TOKEN_LENGTH = 43;

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

/** Unicode code points of the NFKC-normalized form: the form that is hashed (NIST 800-63B-4). */
export function passwordLength(password: string): number {
  return [...password.normalize('NFKC')].length;
}

export const PasswordSchema = z
  .string()
  .refine((value) => passwordLength(value) >= PASSWORD_MIN_LENGTH, {
    error: `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .refine((value) => passwordLength(value) <= PASSWORD_MAX_LENGTH, {
    error: `Debe tener como máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  });

export const UserNameSchema = z
  .string()
  .trim()
  .min(1, 'Debe tener entre 1 y 100 caracteres.')
  .max(100, 'Debe tener entre 1 y 100 caracteres.');

export const RegisterRequestSchema = z.strictObject({
  name: UserNameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const EmailRequestSchema = z.strictObject({ email: EmailSchema });

export type EmailRequest = z.infer<typeof EmailRequestSchema>;

export const TokenRequestSchema = z.strictObject({ token: OpaqueTokenSchema });

export type TokenRequest = z.infer<typeof TokenRequestSchema>;

/** Generic body of every anti-enumeration response (register, resend, reset request). */
export const AcceptedResponseSchema = z.object({ message: z.string() });

export type AcceptedResponse = z.infer<typeof AcceptedResponseSchema>;

export const SessionInfoSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  organizations: z.array(OrganizationSummarySchema),
  csrfToken: OpaqueTokenSchema,
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

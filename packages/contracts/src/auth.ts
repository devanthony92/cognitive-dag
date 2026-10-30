import { z } from 'zod';
import { EMAIL_MAX_LENGTH, EmailSchema, OpaqueTokenSchema } from './primitives.js';
import { OrganizationNameSchema, OrganizationSummarySchema } from './organizations.js';

export const CSRF_HEADER = 'X-CSRF-Token';

/** 32 random bytes as unpadded base64url: opaque tokens in emails and bodies (FR-031). */
export const TOKEN_LENGTH = 43;

// Author's decision (ADR-0026): a deliberate deviation from NIST 800-63B-4 (15 minimum, 64+ maximum).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 25;

/** Login accepts more than the policy allows, so it never reveals the policy. */
export const LOGIN_PASSWORD_MAX_LENGTH = 128;

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
  /** Name of the personal organization; the API defaults it when absent. */
  organizationName: OrganizationNameSchema.optional(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Login takes the email as typed: a malformed address is just another wrong credential, so it
 * gets the same 401 as an unknown one instead of a 422 that tells formats apart (FR-014).
 */
export const LoginRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(EMAIL_MAX_LENGTH),
  // UTF-16 units: 128 code points can take twice as many.
  password: z
    .string()
    .min(1)
    .max(LOGIN_PASSWORD_MAX_LENGTH * 2),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

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

export const PasswordResetConfirmRequestSchema = z.strictObject({
  token: OpaqueTokenSchema,
  password: PasswordSchema,
});

export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const ChangePasswordRequestSchema = z.strictObject({
  // Presence only, like login: the API decides whether it is the right one.
  currentPassword: z
    .string()
    .min(1, 'Ingresa tu contraseña actual.')
    .max(LOGIN_PASSWORD_MAX_LENGTH * 2),
  newPassword: PasswordSchema,
});

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

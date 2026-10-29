import { z } from 'zod';

export const EMAIL_MAX_LENGTH = 254;

/** Emails are stored and compared trimmed and in lower case (FR-004). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, `Debe tener como máximo ${EMAIL_MAX_LENGTH} caracteres.`)
  .pipe(z.email('Debe ser un email válido.'));

export const OpaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'El enlace no es válido.');

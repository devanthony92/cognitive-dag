import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequestSchema,
  EmailRequestSchema,
  LoginRequestSchema,
  PasswordResetConfirmRequestSchema,
  PasswordSchema,
  ProblemCodeSchema,
  ProblemDetailsSchema,
  RegisterRequestSchema,
  TokenRequestSchema,
  normalizeEmail,
} from '../src/index.js';

const VALID_UUID = '3f2b0c1e-5d6a-4b7c-8d9e-0f1a2b3c4d5e';
const TOKEN = 'A'.repeat(43);

describe('PasswordSchema', () => {
  it('rejects 7 characters and accepts 8', () => {
    expect(PasswordSchema.safeParse('a'.repeat(7)).success).toBe(false);
    expect(PasswordSchema.safeParse('a'.repeat(8)).success).toBe(true);
  });

  it('accepts 25 characters and rejects 26', () => {
    expect(PasswordSchema.safeParse('a'.repeat(25)).success).toBe(true);
    expect(PasswordSchema.safeParse('a'.repeat(26)).success).toBe(false);
  });

  it('counts Unicode characters, not UTF-16 units', () => {
    const emoji = '\u{1F600}';
    expect(PasswordSchema.safeParse(emoji.repeat(8)).success).toBe(true);
    expect(PasswordSchema.safeParse(emoji.repeat(7)).success).toBe(false);
    expect(PasswordSchema.safeParse(emoji.repeat(25)).success).toBe(true);
    expect(PasswordSchema.safeParse(emoji.repeat(26)).success).toBe(false);
  });

  it('accepts spaces and does not require composition rules', () => {
    expect(PasswordSchema.safeParse(' '.repeat(8)).success).toBe(true);
    expect(PasswordSchema.safeParse('todo en minusculas ok').success).toBe(true);
  });
});

describe('LoginRequestSchema', () => {
  it('keeps accepting passwords up to 128 characters so it never reveals the policy', () => {
    const email = 'ana@example.com';
    expect(LoginRequestSchema.safeParse({ email, password: 'a'.repeat(128) }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email, password: 'a'.repeat(3) }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email, password: 'a'.repeat(257) }).success).toBe(false);
  });
});

describe('email normalization', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM ')).toBe('ana.perez@example.com');
  });

  it('is applied by the request schemas', () => {
    const parsed = EmailRequestSchema.parse({ email: ' Ana@Example.com ' });
    expect(parsed.email).toBe('ana@example.com');
  });

  it('rejects emails longer than 254 characters', () => {
    const tooLong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(EmailRequestSchema.safeParse({ email: tooLong }).success).toBe(false);
    const edge = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    expect(edge.length).toBeLessThanOrEqual(254);
    expect(EmailRequestSchema.safeParse({ email: edge }).success).toBe(true);
  });

  it('rejects malformed emails', () => {
    expect(EmailRequestSchema.safeParse({ email: 'no-es-un-email' }).success).toBe(false);
  });
});

describe('TokenRequestSchema', () => {
  it('accepts exactly 43 base64url characters', () => {
    expect(TokenRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(TokenRequestSchema.safeParse({ token: `${'a-_Z9'.repeat(8)}abc` }).success).toBe(true);
  });

  it.each([
    ['42 characters', 'A'.repeat(42)],
    ['44 characters', 'A'.repeat(44)],
    ['padding', `${'A'.repeat(42)}=`],
    ['standard base64 alphabet', `${'A'.repeat(41)}+/`],
    ['whitespace', `${'A'.repeat(42)} `],
  ])('rejects %s', (_case, token) => {
    expect(TokenRequestSchema.safeParse({ token }).success).toBe(false);
  });

  it('rejects unknown properties', () => {
    expect(TokenRequestSchema.safeParse({ token: TOKEN, extra: 1 }).success).toBe(false);
  });
});

describe('RegisterRequestSchema', () => {
  const valid = { name: 'Ana', email: 'ana@example.com', password: 'una contrasena larga' };

  it('accepts valid data', () => {
    expect(RegisterRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('trims the optional organization name and bounds it to 1-100 characters', () => {
    const parsed = RegisterRequestSchema.parse({ ...valid, organizationName: '  Acme  ' });
    expect(parsed.organizationName).toBe('Acme');
    expect(RegisterRequestSchema.parse(valid).organizationName).toBeUndefined();
    expect(RegisterRequestSchema.safeParse({ ...valid, organizationName: '   ' }).success).toBe(
      false,
    );
    expect(
      RegisterRequestSchema.safeParse({ ...valid, organizationName: 'o'.repeat(101) }).success,
    ).toBe(false);
  });

  it.each([
    ['empty name', { name: '' }],
    ['name over 100 characters', { name: 'n'.repeat(101) }],
    ['short password', { password: 'corta' }],
    ['unknown property', { admin: true }],
  ])('rejects %s', (_case, patch) => {
    expect(RegisterRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('problem codes of F1', () => {
  it.each([
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'CSRF_REJECTED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
    'TOKEN_INVALID',
    'ALREADY_MEMBER',
    'LAST_OWNER',
  ])('knows %s', (code) => {
    expect(ProblemCodeSchema.safeParse(code).success).toBe(true);
  });

  const base = {
    status: 429,
    title: 'Too Many Requests',
    detail: 'Demasiados intentos.',
    code: 'RATE_LIMITED',
    correlationId: VALID_UUID,
  };

  it('accepts retryAfterSeconds with RATE_LIMITED', () => {
    expect(ProblemDetailsSchema.safeParse({ ...base, retryAfterSeconds: 30 }).success).toBe(true);
  });

  it('rejects retryAfterSeconds with any other code', () => {
    const other = { ...base, status: 404, code: 'NOT_FOUND', retryAfterSeconds: 30 };
    expect(ProblemDetailsSchema.safeParse(other).success).toBe(false);
  });

  it('rejects a non-positive retryAfterSeconds', () => {
    expect(ProblemDetailsSchema.safeParse({ ...base, retryAfterSeconds: 0 }).success).toBe(false);
  });
});

describe('PasswordResetConfirmRequestSchema and ChangePasswordRequestSchema', () => {
  const token = 'a'.repeat(43);

  it('applies the password policy length to the new password only', () => {
    expect(
      PasswordResetConfirmRequestSchema.safeParse({ token, password: 'x'.repeat(7) }).success,
    ).toBe(false);
    expect(
      PasswordResetConfirmRequestSchema.safeParse({ token, password: 'x'.repeat(8) }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({
        currentPassword: 'corta',
        newPassword: 'x'.repeat(8),
      }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'x'.repeat(8) })
        .success,
    ).toBe(false);
  });

  it('rejects unknown fields and malformed tokens', () => {
    expect(
      PasswordResetConfirmRequestSchema.safeParse({ token: 'short', password: 'x'.repeat(8) })
        .success,
    ).toBe(false);
    expect(
      ChangePasswordRequestSchema.safeParse({
        currentPassword: 'a',
        newPassword: 'x'.repeat(8),
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

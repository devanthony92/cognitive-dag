import { describe, expect, it } from 'vitest';
import {
  CreateInvitationRequestSchema,
  CreateOrganizationRequestSchema,
  RoleSchema,
  SessionInfoSchema,
} from '../src/index.js';

const VALID_UUID = '3f2b0c1e-5d6a-4b7c-8d9e-0f1a2b3c4d5e';

describe('RoleSchema', () => {
  it.each(['owner', 'editor', 'viewer'])('accepts %s', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });

  it.each(['admin', 'OWNER', ''])('rejects %j', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(false);
  });
});

describe('CreateOrganizationRequestSchema', () => {
  it('accepts 1 to 100 characters', () => {
    expect(CreateOrganizationRequestSchema.safeParse({ name: 'Acme' }).success).toBe(true);
    expect(CreateOrganizationRequestSchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
  });

  it('rejects empty and over-long names', () => {
    expect(CreateOrganizationRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateOrganizationRequestSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(
      false,
    );
  });
});

describe('CreateInvitationRequestSchema', () => {
  it('normalizes the email and requires a role', () => {
    const parsed = CreateInvitationRequestSchema.parse({ email: ' X@Y.com ', role: 'editor' });
    expect(parsed).toEqual({ email: 'x@y.com', role: 'editor' });
    expect(CreateInvitationRequestSchema.safeParse({ email: 'x@y.com' }).success).toBe(false);
  });
});

describe('SessionInfoSchema', () => {
  const session = {
    user: { id: VALID_UUID, name: 'Ana', email: 'ana@example.com' },
    organizations: [{ id: VALID_UUID, name: 'Personal', role: 'owner', isPersonal: true }],
    csrfToken: 'A'.repeat(43),
  };

  it('accepts a session with a 43-character CSRF token', () => {
    expect(SessionInfoSchema.safeParse(session).success).toBe(true);
  });

  it('rejects a short CSRF token', () => {
    expect(SessionInfoSchema.safeParse({ ...session, csrfToken: 'short' }).success).toBe(false);
  });
});

import { pgEnum } from 'drizzle-orm/pg-core';

export const memberRole = pgEnum('member_role', ['owner', 'editor', 'viewer']);

export const tokenPurpose = pgEnum('token_purpose', ['email_verification', 'password_reset']);

/** Expiry is derived from `expires_at`, so there is no `expired` status. */
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked']);

export const sessionRevokeReason = pgEnum('session_revoke_reason', [
  'logout',
  'password_change',
  'password_reset',
  'idle_timeout',
]);

export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const stepStatus = pgEnum('step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);

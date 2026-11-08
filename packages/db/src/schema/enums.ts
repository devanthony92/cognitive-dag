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
  // A rerun from a node reuses the output of a step that already succeeded (terminal).
  'reused',
]);

/** An effect is `started` before it runs and `committed` once its destination confirmed it. */
export const effectStatus = pgEnum('effect_status', ['started', 'committed']);

/** Connector credentials are always sent as a header (F7, decision 10B). */
export const credentialKind = pgEnum('credential_kind', ['bearer', 'api_key_header', 'basic']);

/** The last four are final (F7, data-model `approvals`). */
export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'timed_out',
  'cancelled',
]);

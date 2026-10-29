-- Hand-written migration (data-model.md, "Aislamiento" and "Privilegios"; research R8 and R9).
--
-- Row-level security reads its context from transaction-local settings:
--   app.user_id, app.organization_id, app.lookup_email, app.lookup_token_hash (hex of a SHA-256).
-- After a transaction that used set_config(..., true), a pooled connection keeps the setting as an
-- empty string instead of NULL, so every read goes through nullif(..., '').

-- Triggers ------------------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Invariant FR-024: an organization always keeps at least one active owner. The application checks
-- first with a clear message; this trigger is the second layer. The FOR UPDATE lock serializes two
-- concurrent demotions: the second one re-reads the committed owners and fails (or deadlocks and
-- is aborted), so the organization can never end up without an owner.
CREATE FUNCTION memberships_keep_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM memberships
    WHERE organization_id = OLD.organization_id AND role = 'owner' AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % would be left without an owner', OLD.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'memberships_keep_owner';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER memberships_keep_owner AFTER UPDATE ON memberships
  FOR EACH ROW
  WHEN (
    OLD.role = 'owner' AND OLD.deleted_at IS NULL
    AND (NEW.role <> 'owner' OR NEW.deleted_at IS NOT NULL
         OR NEW.organization_id <> OLD.organization_id)
  )
  EXECUTE FUNCTION memberships_keep_owner();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE one_time_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE one_time_tokens FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Option A (author-approved 2026-10-29): SELECT policies do not test deleted_at. PostgreSQL also
-- applies the SELECT policy to the NEW row of an UPDATE that reads columns, so a policy with
-- `deleted_at IS NULL` would make soft delete impossible. Queries filter deleted_at in packages/db.

-- users: visible to itself, by email lookup, or as a member of the active organization.
CREATE POLICY users_select ON users FOR SELECT TO app_runtime USING (
  (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    OR email = nullif(current_setting('app.lookup_email', true), '')
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id
        AND m.deleted_at IS NULL
        AND m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    )
  )
);--> statement-breakpoint
CREATE POLICY users_insert ON users FOR INSERT TO app_runtime WITH CHECK (true);--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO app_runtime
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

-- organizations: visible to active members; created by the acting user; updated in the active one.
CREATE POLICY organizations_select ON organizations FOR SELECT TO app_runtime USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.deleted_at IS NULL
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);--> statement-breakpoint
CREATE POLICY organizations_insert ON organizations FOR INSERT TO app_runtime
  WITH CHECK (created_by = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE TO app_runtime
  USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- memberships: own memberships or those of the active organization; written in the active one.
CREATE POLICY memberships_select ON memberships FOR SELECT TO app_runtime USING (
  (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
  )
);--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- sessions: own sessions, or the one whose token hash is being looked up.
CREATE POLICY sessions_select ON sessions FOR SELECT TO app_runtime USING (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY sessions_insert ON sessions FOR INSERT TO app_runtime WITH CHECK (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY sessions_update ON sessions FOR UPDATE TO app_runtime
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  )
  WITH CHECK (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  );--> statement-breakpoint

-- one_time_tokens: same rule as sessions.
CREATE POLICY one_time_tokens_select ON one_time_tokens FOR SELECT TO app_runtime USING (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY one_time_tokens_insert ON one_time_tokens FOR INSERT TO app_runtime WITH CHECK (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY one_time_tokens_update ON one_time_tokens FOR UPDATE TO app_runtime
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  )
  WITH CHECK (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  );--> statement-breakpoint

-- invitations: those of the active organization, or the one whose token hash is being looked up.
CREATE POLICY invitations_select ON invitations FOR SELECT TO app_runtime USING (
  organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY invitations_insert ON invitations FOR INSERT TO app_runtime WITH CHECK (
  organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
  OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
);--> statement-breakpoint
CREATE POLICY invitations_update ON invitations FOR UPDATE TO app_runtime
  USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
  );--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE for the runtime role (soft delete, research R3). ---------

GRANT SELECT, INSERT, UPDATE ON
  users, organizations, memberships, sessions, one_time_tokens, invitations
  TO app_runtime;

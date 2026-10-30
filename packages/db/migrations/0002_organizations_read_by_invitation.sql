-- Hand-written migration (data-model.md, "Aislamiento"; research R8). Option B, approved by the
-- author on 2026-10-29: the invitation preview shows the organization name to a person who is not
-- a member yet, so organizations become readable with the token hash of a pending, unexpired
-- invitation. RLS is row-level: the whole row is readable; the preview endpoint selects only the
-- name. The subquery on invitations is itself subject to invitations_select, which matches the same
-- lookup key, so the token can only ever reach the organization its own invitation belongs to.
-- Write policies are untouched: the token grants no write access.

DROP POLICY organizations_select ON organizations;--> statement-breakpoint
CREATE POLICY organizations_select ON organizations FOR SELECT TO app_runtime USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.deleted_at IS NULL
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR EXISTS (
    SELECT 1 FROM invitations i
    WHERE i.organization_id = organizations.id
      AND i.token_hash = decode(nullif(current_setting('app.lookup_token_hash', true), ''), 'hex')
      AND i.status = 'pending'
      AND i.expires_at > now()
  )
);

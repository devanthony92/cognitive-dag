-- Hand-written migration. Author-approved change to data-model.md (2026-10-30, option B): the
-- operator script connects as app_migrator, the owner of organization_limits, which is still
-- subject to its forced row-level security. This policy lets that role, and only that role, write
-- the table. The policies and privileges of app_runtime are untouched (SELECT only).

CREATE POLICY organization_limits_operator ON organization_limits FOR ALL TO app_migrator
  USING (true) WITH CHECK (true);

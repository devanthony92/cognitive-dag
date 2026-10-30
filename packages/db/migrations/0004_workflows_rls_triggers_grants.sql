-- Hand-written migration (specs/003-dag-model-editor/data-model.md, "Aislamiento", "Privilegios" and
-- "Triggers"; research R9 to R12). Same conventions as 0001: policies read their context from the
-- transaction-local setting app.organization_id through nullif(..., ''), and soft delete is not
-- tested in the policies (option A): queries filter `deleted_at` in packages/db.

-- Triggers ------------------------------------------------------------------------------------

CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- The organization copied into a version or an active-version row must be the workflow's own. The
-- lookup runs under the caller's row-level security: a workflow of another organization is not
-- visible, so the check fails closed. BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION workflow_child_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflows w
    WHERE w.id = NEW.workflow_id AND w.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% row of workflow % does not belong to organization %',
      TG_TABLE_NAME, NEW.workflow_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_versions_same_organization BEFORE INSERT OR UPDATE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION workflow_child_same_organization();--> statement-breakpoint
CREATE TRIGGER workflow_active_versions_same_organization
  BEFORE INSERT OR UPDATE ON workflow_active_versions
  FOR EACH ROW EXECUTE FUNCTION workflow_child_same_organization();--> statement-breakpoint

-- FR-017: archiving a workflow leaves it without an active version.
CREATE FUNCTION workflows_archive_deactivates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE workflow_active_versions
    SET version_id = NULL, activated_by = NULL, activated_at = NULL
    WHERE workflow_id = NEW.id;
  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflows_archive_deactivates AFTER UPDATE OF deleted_at ON workflows
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION workflows_archive_deactivates();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_active_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_active_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organization_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organization_limits FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- workflows: read and write inside the active organization.
CREATE POLICY workflows_select ON workflows FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflows_insert ON workflows FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflows_update ON workflows FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- workflow_versions: read and insert; there is no UPDATE policy and no UPDATE privilege.
CREATE POLICY workflow_versions_select ON workflow_versions FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_versions_insert ON workflow_versions FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- workflow_active_versions: read and write inside the active organization.
CREATE POLICY workflow_active_versions_select ON workflow_active_versions FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_active_versions_insert ON workflow_active_versions FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_active_versions_update ON workflow_active_versions FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- organization_limits: read only for the runtime role.
CREATE POLICY organization_limits_select ON organization_limits FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE anywhere (data-model.md, "Privilegios"). -----------------

GRANT SELECT, INSERT, UPDATE ON workflows, workflow_active_versions TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON workflow_versions TO app_runtime;--> statement-breakpoint
GRANT SELECT ON organization_limits TO app_runtime;

-- Hand-written migration (specs/004-execution-engine/data-model.md, "Aislamiento y privilegios" and
-- "Triggers"). Same conventions as 0004: policies read their context from the transaction-local
-- setting app.organization_id through nullif(..., ''), and there is no DELETE and no TRUNCATE.

-- Triggers ------------------------------------------------------------------------------------

CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workflow_run_steps_set_updated_at BEFORE UPDATE ON workflow_run_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- The organization copied into a run must be the workflow's own. The lookup runs under the
-- caller's row-level security: a workflow of another organization is not visible, so the check
-- fails closed. BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION workflow_run_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflows w
    WHERE w.id = NEW.workflow_id AND w.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_runs row of workflow % does not belong to organization %',
      NEW.workflow_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_runs_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_runs_same_organization BEFORE INSERT OR UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION workflow_run_same_organization();--> statement-breakpoint

-- The organization copied into a step must be its run's own (same fail-closed lookup).
CREATE FUNCTION workflow_run_step_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflow_runs r
    WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_run_steps row of run % does not belong to organization %',
      NEW.run_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_run_steps_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_run_steps_same_organization BEFORE INSERT OR UPDATE ON workflow_run_steps
  FOR EACH ROW EXECUTE FUNCTION workflow_run_step_same_organization();--> statement-breakpoint

-- A run in a terminal state never goes back to another state.
CREATE FUNCTION workflow_runs_terminal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run % is % and cannot become %', OLD.id, OLD.status, NEW.status
    USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_runs_terminal_immutable';
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_runs_terminal_immutable BEFORE UPDATE OF status ON workflow_runs
  FOR EACH ROW
  WHEN (OLD.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
        AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION workflow_runs_terminal_immutable();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_run_steps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_run_steps FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY workflow_runs_select ON workflow_runs FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_runs_insert ON workflow_runs FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_runs_update ON workflow_runs FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY workflow_run_steps_select ON workflow_run_steps FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_run_steps_insert ON workflow_run_steps FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_run_steps_update ON workflow_run_steps FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE ---------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON workflow_runs, workflow_run_steps TO app_runtime;

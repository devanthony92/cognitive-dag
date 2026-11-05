-- Hand-written migration (specs/006-cognitive-nodes/data-model.md, "Aislamiento y privilegios" and
-- "Triggers"). Same conventions as 0007 and 0009: policies read their context from the
-- transaction-local setting app.organization_id through nullif(..., ''), and there is no DELETE
-- and no TRUNCATE.

-- Triggers ------------------------------------------------------------------------------------

CREATE TRIGGER llm_usage_daily_set_updated_at BEFORE UPDATE ON llm_usage_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- The organization copied into a call must be its run's own. The lookup runs under the caller's
-- row-level security: a run of another organization is not visible, so the check fails closed.
-- BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION llm_call_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflow_runs r
    WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'llm_calls row of run % does not belong to organization %',
      NEW.run_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'llm_calls_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER llm_calls_same_organization BEFORE INSERT ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION llm_call_same_organization();--> statement-breakpoint

-- A call is a record of something that already happened: it is never modified.
CREATE FUNCTION llm_calls_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'llm_calls row % is immutable', OLD.id
    USING ERRCODE = 'check_violation', CONSTRAINT = 'llm_calls_immutable';
END
$$;--> statement-breakpoint

CREATE TRIGGER llm_calls_immutable BEFORE UPDATE ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION llm_calls_immutable();--> statement-breakpoint

-- F3's rule, adjusted: a run in a terminal state never goes back to another state, and its
-- llm_tokens_used can only be adjusted downwards (a call in flight that settles after the run was
-- cancelled returns what it reserved and nothing more).
CREATE OR REPLACE FUNCTION workflow_runs_terminal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'run % is % and cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_runs_terminal_immutable';
  END IF;
  RAISE EXCEPTION 'run % is % and its llm_tokens_used can only go down', OLD.id, OLD.status
    USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_runs_terminal_immutable';
END
$$;--> statement-breakpoint

DROP TRIGGER workflow_runs_terminal_immutable ON workflow_runs;--> statement-breakpoint

CREATE TRIGGER workflow_runs_terminal_immutable BEFORE UPDATE OF status, llm_tokens_used ON workflow_runs
  FOR EACH ROW
  WHEN (OLD.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
        AND (NEW.status IS DISTINCT FROM OLD.status
             OR NEW.llm_tokens_used > OLD.llm_tokens_used))
  EXECUTE FUNCTION workflow_runs_terminal_immutable();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE llm_calls FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE llm_usage_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE llm_usage_daily FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY llm_calls_select ON llm_calls FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY llm_calls_insert ON llm_calls FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY llm_usage_daily_select ON llm_usage_daily FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY llm_usage_daily_insert ON llm_usage_daily FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY llm_usage_daily_update ON llm_usage_daily FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE; llm_calls is append-only ---------------------------------

GRANT SELECT, INSERT ON llm_calls TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON llm_usage_daily TO app_runtime;

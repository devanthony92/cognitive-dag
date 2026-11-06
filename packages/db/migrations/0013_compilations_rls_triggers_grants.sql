-- Hand-written migration (specs/007-nl-compiler/data-model.md, "Aislamiento y privilegios" and
-- "Triggers"). Same conventions as 0007, 0009 and 0011: policies read their context from the
-- transaction-local setting app.organization_id through nullif(..., ''), and there is no DELETE
-- and no TRUNCATE.

-- Triggers ------------------------------------------------------------------------------------

-- The workflow of a compilation must belong to the compilation's organization. The lookup runs
-- under the caller's row-level security: a workflow of another organization is not visible, so the
-- check fails closed. BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION compilations_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_id IS NOT NULL THEN
    PERFORM 1 FROM workflows w
      WHERE w.id = NEW.workflow_id AND w.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'compilations row of workflow % does not belong to organization %',
        NEW.workflow_id, NEW.organization_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'compilations_same_organization';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER compilations_same_organization BEFORE INSERT ON compilations
  FOR EACH ROW EXECUTE FUNCTION compilations_same_organization();--> statement-breakpoint

-- A compilation moves along its life cycle and nothing else: once final it never changes, and the
-- columns that identify and describe the request never change at all.
CREATE FUNCTION compilations_terminal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'compilation % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'compilations_terminal_immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.base_draft_revision IS DISTINCT FROM OLD.base_draft_revision
     OR NEW.intent_chars IS DISTINCT FROM OLD.intent_chars
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'compilation % has columns that never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'compilations_terminal_immutable';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER compilations_terminal_immutable BEFORE UPDATE ON compilations
  FOR EACH ROW EXECUTE FUNCTION compilations_terminal_immutable();--> statement-breakpoint

-- F5's rule, widened: the organization copied into a call must be that of its owner, the run or
-- the compilation (the CHECK llm_calls_owner_consistent guarantees there is exactly one).
CREATE OR REPLACE FUNCTION llm_call_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_id IS NOT NULL THEN
    PERFORM 1 FROM workflow_runs r
      WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'llm_calls row of run % does not belong to organization %',
        NEW.run_id, NEW.organization_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'llm_calls_same_organization';
    END IF;
  ELSIF NEW.compilation_id IS NOT NULL THEN
    PERFORM 1 FROM compilations c
      WHERE c.id = NEW.compilation_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'llm_calls row of compilation % does not belong to organization %',
        NEW.compilation_id, NEW.organization_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'llm_calls_same_organization';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE compilations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE compilations FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY compilations_select ON compilations FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY compilations_insert ON compilations FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY compilations_update ON compilations FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE. llm_calls keeps SELECT and INSERT (granted in 0011) -----

GRANT SELECT, INSERT, UPDATE ON compilations TO app_runtime;

-- Hand-written migration (specs/005-resilience/data-model.md, "Aislamiento y privilegios" and
-- "Triggers"). Same conventions as 0007: policies read their context from the transaction-local
-- setting app.organization_id through nullif(..., ''), and there is no DELETE and no TRUNCATE.

-- Triggers ------------------------------------------------------------------------------------

CREATE TRIGGER node_effects_set_updated_at BEFORE UPDATE ON node_effects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- The organization copied into an effect must be its run's own. The lookup runs under the
-- caller's row-level security: a run of another organization is not visible, so the check
-- fails closed. BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION node_effect_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflow_runs r
    WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'node_effects row of run % does not belong to organization %',
      NEW.run_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'node_effects_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER node_effects_same_organization BEFORE INSERT OR UPDATE ON node_effects
  FOR EACH ROW EXECUTE FUNCTION node_effect_same_organization();--> statement-breakpoint

-- A committed effect never goes back to started: it must not be repeated.
CREATE FUNCTION node_effects_committed_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'effect % is committed and cannot become %', OLD.idempotency_key, NEW.status
    USING ERRCODE = 'check_violation', CONSTRAINT = 'node_effects_committed_immutable';
END
$$;--> statement-breakpoint

CREATE TRIGGER node_effects_committed_immutable BEFORE UPDATE OF status ON node_effects
  FOR EACH ROW
  WHEN (OLD.status = 'committed' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION node_effects_committed_immutable();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE node_effects ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE node_effects FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY node_effects_select ON node_effects FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY node_effects_insert ON node_effects FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY node_effects_update ON node_effects FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE ---------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON node_effects TO app_runtime;

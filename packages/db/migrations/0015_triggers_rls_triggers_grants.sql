-- Hand-written migration (specs/008-triggers-human-control/data-model.md, "Aislamiento y
-- privilegios" and "Triggers"). Same conventions as 0007 and 0013: policies read their context from
-- the transaction-local setting app.organization_id through nullif(..., ''), and there is no DELETE
-- and no TRUNCATE. The two lookup keys follow the pattern of 0002 (ADR-0032) and only ever grant
-- read access.

-- Triggers ------------------------------------------------------------------------------------

CREATE TRIGGER workflow_schedules_updated_at BEFORE UPDATE ON workflow_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER credentials_updated_at BEFORE UPDATE ON credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- The workflow of a webhook must belong to the webhook's organization. The lookup runs under the
-- caller's row-level security: a workflow of another organization is not visible, so the check
-- fails closed. BEFORE triggers run before the policies' WITH CHECK.
CREATE FUNCTION webhook_triggers_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflows w
    WHERE w.id = NEW.workflow_id AND w.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook_triggers row of workflow % does not belong to organization %',
      NEW.workflow_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_triggers_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER webhook_triggers_same_organization BEFORE INSERT ON webhook_triggers
  FOR EACH ROW EXECUTE FUNCTION webhook_triggers_same_organization();--> statement-breakpoint

-- Regenerating the token is the only change a webhook admits: the hash is replaced by a different
-- one and the generation goes up by exactly one.
CREATE FUNCTION webhook_triggers_regenerate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'webhook_triggers % has columns that never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_triggers_regenerate';
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    IF NEW.generation <> OLD.generation + 1 THEN
      RAISE EXCEPTION 'webhook_triggers % must raise its generation by one', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_triggers_regenerate';
    END IF;
  ELSIF NEW.generation IS DISTINCT FROM OLD.generation THEN
    RAISE EXCEPTION 'webhook_triggers % changes its generation only with a new token', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'webhook_triggers_regenerate';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER webhook_triggers_regenerate BEFORE UPDATE ON webhook_triggers
  FOR EACH ROW EXECUTE FUNCTION webhook_triggers_regenerate();--> statement-breakpoint

-- The workflow and the version of a schedule must belong to its organization (same fail-closed
-- lookup). It also runs on UPDATE, because the version changes when another one is activated.
CREATE FUNCTION workflow_schedules_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflows w
    WHERE w.id = NEW.workflow_id AND w.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_schedules row of workflow % does not belong to organization %',
      NEW.workflow_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_schedules_same_organization';
  END IF;
  PERFORM 1 FROM workflow_versions v
    WHERE v.id = NEW.version_id AND v.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_schedules row of version % does not belong to organization %',
      NEW.version_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_schedules_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_schedules_same_organization BEFORE INSERT OR UPDATE ON workflow_schedules
  FOR EACH ROW EXECUTE FUNCTION workflow_schedules_same_organization();--> statement-breakpoint

CREATE FUNCTION workflow_schedules_immutable_keys() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id THEN
    RAISE EXCEPTION 'workflow_schedules % has columns that never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_schedules_immutable_keys';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_schedules_immutable_keys BEFORE UPDATE ON workflow_schedules
  FOR EACH ROW EXECUTE FUNCTION workflow_schedules_immutable_keys();--> statement-breakpoint

-- The run of an approval must belong to the approval's organization, and the requester and the
-- workflow are copied from that run, never taken from the caller.
CREATE FUNCTION approvals_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflow_runs r
    WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approvals row of run % does not belong to organization %',
      NEW.run_id, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER approvals_same_organization BEFORE INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION approvals_same_organization();--> statement-breakpoint

CREATE FUNCTION approvals_requester_copy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workflow_runs r
    WHERE r.id = NEW.run_id
      AND r.workflow_id = NEW.workflow_id
      AND r.triggered_by IS NOT DISTINCT FROM NEW.run_triggered_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approvals row of run % does not copy the workflow and the requester of the run',
      NEW.run_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_requester_copy';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER approvals_requester_copy BEFORE INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION approvals_requester_copy();--> statement-breakpoint

-- Defense in depth for decision 7A (the main rule lives in the API): whoever decides is not the
-- person who started the run, and holds an owner or editor membership of the organization.
CREATE FUNCTION approvals_decider_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decided_by IS NOT DISTINCT FROM NEW.run_triggered_by THEN
    RAISE EXCEPTION 'approvals % cannot be decided by the person who started the run', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_decider_check';
  END IF;
  PERFORM 1 FROM memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.user_id = NEW.decided_by
      AND m.deleted_at IS NULL
      AND m.role IN ('owner', 'editor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approvals % must be decided by an owner or editor of the organization', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_decider_check';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER approvals_decider_check BEFORE UPDATE ON approvals
  FOR EACH ROW
  WHEN (NEW.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by)
  EXECUTE FUNCTION approvals_decider_check();--> statement-breakpoint

-- A final approval never changes; the columns that identify the request never change at all.
CREATE FUNCTION approvals_terminal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'approvals % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_terminal_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.node_id IS DISTINCT FROM OLD.node_id
     OR NEW.node_label IS DISTINCT FROM OLD.node_label
     OR NEW.run_triggered_by IS DISTINCT FROM OLD.run_triggered_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'approvals % has columns that never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'approvals_terminal_immutable';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER approvals_terminal_immutable BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION approvals_terminal_immutable();--> statement-breakpoint

-- The creator of a credential is a live member of the organization (looked up under the caller's
-- row-level security, so it fails closed).
CREATE FUNCTION credentials_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.user_id = NEW.created_by
      AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credentials row of user % does not belong to organization %',
      NEW.created_by, NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credentials_same_organization';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER credentials_same_organization BEFORE INSERT ON credentials
  FOR EACH ROW EXECUTE FUNCTION credentials_same_organization();--> statement-breakpoint

-- Changing the kind is creating another credential; an archived one never changes; the master key
-- version never goes down.
CREATE FUNCTION credentials_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'credentials % is archived and cannot change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credentials_guard';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.header_name IS DISTINCT FROM OLD.header_name
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'credentials % has columns that never change', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credentials_guard';
  END IF;
  IF NEW.key_version < OLD.key_version THEN
    RAISE EXCEPTION 'credentials % cannot go back to an older master key', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credentials_guard';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER credentials_guard BEFORE UPDATE ON credentials
  FOR EACH ROW EXECUTE FUNCTION credentials_guard();--> statement-breakpoint

-- At most 100 live entries per organization. The advisory lock serializes concurrent inserts of the
-- same organization so the count cannot be raced.
CREATE FUNCTION http_allowed_hosts_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  live integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('http_allowed_hosts:' || NEW.organization_id::text, 0));
  SELECT count(*) INTO live FROM http_allowed_hosts h
    WHERE h.organization_id = NEW.organization_id AND h.removed_at IS NULL;
  IF live >= 100 THEN
    RAISE EXCEPTION 'organization % already has 100 allowed hosts', NEW.organization_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'http_allowed_hosts_limit';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER http_allowed_hosts_limit BEFORE INSERT ON http_allowed_hosts
  FOR EACH ROW EXECUTE FUNCTION http_allowed_hosts_limit();--> statement-breakpoint

-- An entry is only ever retired, once.
CREATE FUNCTION http_allowed_hosts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.removed_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.pattern IS DISTINCT FROM OLD.pattern
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'http_allowed_hosts % admits only its retirement, once', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'http_allowed_hosts_guard';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER http_allowed_hosts_guard BEFORE UPDATE ON http_allowed_hosts
  FOR EACH ROW EXECUTE FUNCTION http_allowed_hosts_guard();--> statement-breakpoint

-- What fired a run is fixed when it is inserted.
CREATE FUNCTION workflow_runs_trigger_columns_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run % cannot change what fired it', OLD.id
    USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_runs_trigger_columns_immutable';
END
$$;--> statement-breakpoint

CREATE TRIGGER workflow_runs_trigger_columns_immutable
  BEFORE UPDATE OF trigger_kind, trigger_event_id, scheduled_at ON workflow_runs
  FOR EACH ROW
  WHEN (NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind
        OR NEW.trigger_event_id IS DISTINCT FROM OLD.trigger_event_id
        OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)
  EXECUTE FUNCTION workflow_runs_trigger_columns_immutable();--> statement-breakpoint

-- Row-level security ----------------------------------------------------------------------------

ALTER TABLE webhook_triggers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE webhook_triggers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workflow_schedules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE http_allowed_hosts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE http_allowed_hosts FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- webhook_triggers: the public endpoint does not know the organization, so a row is also readable
-- by its own id through app.lookup_webhook_trigger_id. That key never grants a write.
CREATE POLICY webhook_triggers_select ON webhook_triggers FOR SELECT TO app_runtime
  USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR id = nullif(current_setting('app.lookup_webhook_trigger_id', true), '')::uuid
  );--> statement-breakpoint
CREATE POLICY webhook_triggers_insert ON webhook_triggers FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY webhook_triggers_update ON webhook_triggers FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- workflow_schedules: the reconciler does not know the organizations; with app.reconciler it can
-- only read the rows that are not synced. It writes inside the context of each row's organization.
CREATE POLICY workflow_schedules_select ON workflow_schedules FOR SELECT TO app_runtime
  USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR (current_setting('app.reconciler', true) = 'schedules' AND sync_status <> 'synced')
  );--> statement-breakpoint
CREATE POLICY workflow_schedules_insert ON workflow_schedules FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY workflow_schedules_update ON workflow_schedules FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY approvals_select ON approvals FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY approvals_insert ON approvals FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY approvals_update ON approvals FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY credentials_select ON credentials FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY credentials_insert ON credentials FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY credentials_update ON credentials FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY http_allowed_hosts_select ON http_allowed_hosts FOR SELECT TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY http_allowed_hosts_insert ON http_allowed_hosts FOR INSERT TO app_runtime
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY http_allowed_hosts_update ON http_allowed_hosts FOR UPDATE TO app_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Privileges: no DELETE and no TRUNCATE ---------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON
  webhook_triggers, workflow_schedules, approvals, credentials, http_allowed_hosts
  TO app_runtime;

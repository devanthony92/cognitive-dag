CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('bearer', 'api_key_header', 'basic');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_label" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"run_triggered_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"decided_by" uuid,
	"has_comment" boolean DEFAULT false NOT NULL,
	"notified_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "approvals_node_id_format" CHECK ("approvals"."node_id" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "approvals_node_label_length" CHECK (char_length("approvals"."node_label") BETWEEN 1 AND 100),
	CONSTRAINT "approvals_expires_after_request" CHECK ("approvals"."expires_at" > "approvals"."requested_at"),
	CONSTRAINT "approvals_notified_count_range" CHECK ("approvals"."notified_count" BETWEEN 0 AND 20),
	CONSTRAINT "approvals_status_consistent" CHECK (("approvals"."status" = 'pending' AND "approvals"."resolved_at" IS NULL AND "approvals"."decided_by" IS NULL)
        OR ("approvals"."status" IN ('approved', 'rejected') AND "approvals"."resolved_at" IS NOT NULL AND "approvals"."decided_by" IS NOT NULL)
        OR ("approvals"."status" IN ('timed_out', 'cancelled') AND "approvals"."resolved_at" IS NOT NULL AND "approvals"."decided_by" IS NULL)),
	CONSTRAINT "approvals_comment_needs_decider" CHECK ("approvals"."has_comment" = false OR "approvals"."decided_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"header_name" text,
	"dek_wrapped" "bytea" NOT NULL,
	"dek_iv" "bytea" NOT NULL,
	"dek_tag" "bytea" NOT NULL,
	"secret_ct" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"secret_tag" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid,
	"rotated_at" timestamp with time zone,
	"archived_by" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "credentials_name_length" CHECK (char_length("credentials"."name") BETWEEN 1 AND 64),
	CONSTRAINT "credentials_dek_wrapped_length" CHECK (octet_length("credentials"."dek_wrapped") = 32),
	CONSTRAINT "credentials_dek_iv_length" CHECK (octet_length("credentials"."dek_iv") = 12),
	CONSTRAINT "credentials_dek_tag_length" CHECK (octet_length("credentials"."dek_tag") = 16),
	CONSTRAINT "credentials_secret_ct_length" CHECK (octet_length("credentials"."secret_ct") BETWEEN 1 AND 4096),
	CONSTRAINT "credentials_secret_iv_length" CHECK (octet_length("credentials"."secret_iv") = 12),
	CONSTRAINT "credentials_secret_tag_length" CHECK (octet_length("credentials"."secret_tag") = 16),
	CONSTRAINT "credentials_key_version_positive" CHECK ("credentials"."key_version" >= 1),
	CONSTRAINT "credentials_header_name_consistent" CHECK (("credentials"."kind" = 'api_key_header') = ("credentials"."header_name" IS NOT NULL)),
	CONSTRAINT "credentials_header_name_valid" CHECK ("credentials"."header_name" IS NULL OR (
        "credentials"."header_name" ~ '^[A-Za-z0-9-]{1,64}$'
        AND lower("credentials"."header_name") NOT IN ('host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'cookie', 'set-cookie', 'authorization', 'idempotency-key')
        AND lower("credentials"."header_name") NOT LIKE 'proxy-%')),
	CONSTRAINT "credentials_rotated_pair" CHECK (("credentials"."rotated_by" IS NULL) = ("credentials"."rotated_at" IS NULL)),
	CONSTRAINT "credentials_archived_pair" CHECK (("credentials"."archived_by" IS NULL) = ("credentials"."archived_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "http_allowed_hosts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	CONSTRAINT "http_allowed_hosts_pattern_length" CHECK (char_length("http_allowed_hosts"."pattern") BETWEEN 4 AND 253),
	CONSTRAINT "http_allowed_hosts_pattern_lower" CHECK ("http_allowed_hosts"."pattern" = lower("http_allowed_hosts"."pattern")),
	CONSTRAINT "http_allowed_hosts_pattern_format" CHECK ("http_allowed_hosts"."pattern" ~ '^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "http_allowed_hosts_pattern_not_ip" CHECK ("http_allowed_hosts"."pattern" !~ '^[0-9.*]+$' AND position(':' in "http_allowed_hosts"."pattern") = 0),
	CONSTRAINT "http_allowed_hosts_removed_pair" CHECK (("http_allowed_hosts"."removed_by" IS NULL) = ("http_allowed_hosts"."removed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "webhook_triggers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"generated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_triggers_workflow_id_key" UNIQUE("workflow_id"),
	CONSTRAINT "webhook_triggers_token_hash_length" CHECK (octet_length("webhook_triggers"."token_hash") = 32),
	CONSTRAINT "webhook_triggers_generation_positive" CHECK ("webhook_triggers"."generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"desired_state" text DEFAULT 'scheduled' NOT NULL,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_attempts" smallint DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_schedules_workflow_id_key" UNIQUE("workflow_id"),
	CONSTRAINT "workflow_schedules_cron_length" CHECK (char_length("workflow_schedules"."cron") BETWEEN 9 AND 100),
	CONSTRAINT "workflow_schedules_timezone_length" CHECK (char_length("workflow_schedules"."timezone") BETWEEN 1 AND 64),
	CONSTRAINT "workflow_schedules_desired_state_valid" CHECK ("workflow_schedules"."desired_state" IN ('scheduled', 'removed')),
	CONSTRAINT "workflow_schedules_sync_status_valid" CHECK ("workflow_schedules"."sync_status" IN ('pending', 'synced', 'failed')),
	CONSTRAINT "workflow_schedules_sync_attempts_non_negative" CHECK ("workflow_schedules"."sync_attempts" >= 0),
	CONSTRAINT "workflow_schedules_last_error_code_length" CHECK (char_length("workflow_schedules"."last_error_code") <= 64),
	CONSTRAINT "workflow_schedules_sync_consistent" CHECK (("workflow_schedules"."sync_status" <> 'synced' OR "workflow_schedules"."synced_at" IS NOT NULL)
        AND (("workflow_schedules"."last_error_code" IS NOT NULL) = ("workflow_schedules"."sync_status" = 'failed')))
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" DROP CONSTRAINT "workflow_run_steps_waiting_reason_valid";--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "triggered_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_limits" ADD COLUMN "max_active_schedules" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "trigger_kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "trigger_event_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_triggered_by_users_id_fk" FOREIGN KEY ("run_triggered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_rotated_by_users_id_fk" FOREIGN KEY ("rotated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_allowed_hosts" ADD CONSTRAINT "http_allowed_hosts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_allowed_hosts" ADD CONSTRAINT "http_allowed_hosts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_allowed_hosts" ADD CONSTRAINT "http_allowed_hosts_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_triggers" ADD CONSTRAINT "webhook_triggers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_triggers" ADD CONSTRAINT "webhook_triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_triggers" ADD CONSTRAINT "webhook_triggers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_triggers" ADD CONSTRAINT "webhook_triggers_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_version_fkey" FOREIGN KEY ("version_id","workflow_id") REFERENCES "public"."workflow_versions"("id","workflow_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_run_node_key" ON "approvals" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "approvals_organization_pending_idx" ON "approvals" USING btree ("organization_id","requested_at" DESC NULLS LAST) WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approvals_organization_resolved_idx" ON "approvals" USING btree ("organization_id","resolved_at" DESC NULLS LAST) WHERE "approvals"."status" <> 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_organization_name_active_key" ON "credentials" USING btree ("organization_id","name") WHERE "credentials"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "credentials_organization_created_idx" ON "credentials" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "http_allowed_hosts_organization_pattern_active_key" ON "http_allowed_hosts" USING btree ("organization_id","pattern") WHERE "http_allowed_hosts"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflow_schedules_unsynced_idx" ON "workflow_schedules" USING btree ("sync_status") WHERE "workflow_schedules"."sync_status" <> 'synced';--> statement-breakpoint
CREATE INDEX "workflow_schedules_organization_active_idx" ON "workflow_schedules" USING btree ("organization_id") WHERE "workflow_schedules"."desired_state" = 'scheduled';--> statement-breakpoint
ALTER TABLE "organization_limits" ADD CONSTRAINT "organization_limits_max_active_schedules" CHECK ("organization_limits"."max_active_schedules" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_waiting_reason_valid" CHECK ("workflow_run_steps"."waiting_reason" IN ('rate_limited', 'approval', 'circuit_open'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_kind_valid" CHECK ("workflow_runs"."trigger_kind" IN ('manual', 'webhook', 'schedule'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_event_id_length" CHECK (char_length("workflow_runs"."trigger_event_id") BETWEEN 1 AND 128);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_consistent" CHECK (("workflow_runs"."trigger_kind" = 'manual' AND "workflow_runs"."triggered_by" IS NOT NULL
          AND "workflow_runs"."trigger_event_id" IS NULL AND "workflow_runs"."scheduled_at" IS NULL)
        OR ("workflow_runs"."trigger_kind" = 'webhook' AND "workflow_runs"."triggered_by" IS NULL
          AND "workflow_runs"."trigger_event_id" IS NOT NULL AND "workflow_runs"."scheduled_at" IS NULL AND "workflow_runs"."rerun_of" IS NULL)
        OR ("workflow_runs"."trigger_kind" = 'schedule' AND "workflow_runs"."triggered_by" IS NULL
          AND "workflow_runs"."trigger_event_id" IS NULL AND "workflow_runs"."scheduled_at" IS NOT NULL AND "workflow_runs"."rerun_of" IS NULL));
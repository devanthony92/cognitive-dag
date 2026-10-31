CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_steps_node_id_format" CHECK ("workflow_run_steps"."node_id" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "workflow_run_steps_node_type_length" CHECK (char_length("workflow_run_steps"."node_type") <= 40),
	CONSTRAINT "workflow_run_steps_attempts_non_negative" CHECK ("workflow_run_steps"."attempts" >= 0),
	CONSTRAINT "workflow_run_steps_duration_non_negative" CHECK ("workflow_run_steps"."duration_ms" >= 0),
	CONSTRAINT "workflow_run_steps_error_code_length" CHECK (char_length("workflow_run_steps"."error_code") <= 64),
	CONSTRAINT "workflow_run_steps_error_message_length" CHECK (char_length("workflow_run_steps"."error_message") <= 500)
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"triggered_by" uuid NOT NULL,
	"cancelled_by" uuid,
	"rerun_of" uuid,
	"correlation_id" uuid NOT NULL,
	"temporal_workflow_id" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_temporal_workflow_id_key" UNIQUE("temporal_workflow_id"),
	CONSTRAINT "workflow_runs_version_number_positive" CHECK ("workflow_runs"."version_number" >= 1),
	CONSTRAINT "workflow_runs_error_code_length" CHECK (char_length("workflow_runs"."error_code") <= 64),
	CONSTRAINT "workflow_runs_error_message_length" CHECK (char_length("workflow_runs"."error_message") <= 500),
	CONSTRAINT "workflow_runs_finished_consistent" CHECK (("workflow_runs"."status" IN ('queued', 'running') AND "workflow_runs"."finished_at" IS NULL)
        OR ("workflow_runs"."status" IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND "workflow_runs"."finished_at" IS NOT NULL)),
	CONSTRAINT "workflow_runs_cancelled_by_consistent" CHECK ("workflow_runs"."cancelled_by" IS NULL OR "workflow_runs"."status" = 'cancelled')
);
--> statement-breakpoint
ALTER TABLE "organization_limits" ADD COLUMN "max_concurrent_runs" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_rerun_of_workflow_runs_id_fk" FOREIGN KEY ("rerun_of") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_version_fkey" FOREIGN KEY ("version_id","workflow_id") REFERENCES "public"."workflow_versions"("id","workflow_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_steps_run_node_key" ON "workflow_run_steps" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_created_idx" ON "workflow_runs" USING btree ("workflow_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workflow_runs_organization_in_progress_idx" ON "workflow_runs" USING btree ("organization_id") WHERE "workflow_runs"."status" IN ('queued', 'running');--> statement-breakpoint
ALTER TABLE "organization_limits" ADD CONSTRAINT "organization_limits_max_concurrent_runs" CHECK ("organization_limits"."max_concurrent_runs" BETWEEN 1 AND 100);
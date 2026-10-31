CREATE TYPE "public"."effect_status" AS ENUM('started', 'committed');--> statement-breakpoint
ALTER TYPE "public"."step_status" ADD VALUE 'reused';--> statement-breakpoint
CREATE TABLE "node_effects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "effect_status" DEFAULT 'started' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_effects_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "node_effects_node_id_format" CHECK ("node_effects"."node_id" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "node_effects_idempotency_key_format" CHECK ("node_effects"."idempotency_key" = "node_effects"."run_id"::text || ':' || "node_effects"."node_id"),
	CONSTRAINT "node_effects_attempts_positive" CHECK ("node_effects"."attempts" >= 1),
	CONSTRAINT "node_effects_committed_at_consistent" CHECK (("node_effects"."status" = 'committed' AND "node_effects"."committed_at" IS NOT NULL)
        OR ("node_effects"."status" = 'started' AND "node_effects"."committed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "error_class" text;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "waiting_reason" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "rerun_from_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "error_class" text;--> statement-breakpoint
ALTER TABLE "node_effects" ADD CONSTRAINT "node_effects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_effects" ADD CONSTRAINT "node_effects_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_effects_run_idx" ON "node_effects" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_organization_created_idx" ON "workflow_runs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workflow_runs_organization_failed_idx" ON "workflow_runs" USING btree ("organization_id","created_at" DESC NULLS LAST) WHERE "workflow_runs"."status" = 'failed';--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_error_class_valid" CHECK ("workflow_run_steps"."error_class" IN ('transient', 'rate_limited', 'timeout', 'permanent'));--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_error_class_failed" CHECK ("workflow_run_steps"."error_class" IS NULL OR "workflow_run_steps"."status" = 'failed');--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_waiting_reason_valid" CHECK ("workflow_run_steps"."waiting_reason" IN ('rate_limited'));--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_waiting_reason_running" CHECK ("workflow_run_steps"."waiting_reason" IS NULL OR "workflow_run_steps"."status" = 'running');--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_rerun_from_node_id_format" CHECK ("workflow_runs"."rerun_from_node_id" ~ '^[a-z][a-z0-9_]{0,39}$');--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_rerun_from_requires_rerun" CHECK ("workflow_runs"."rerun_from_node_id" IS NULL OR "workflow_runs"."rerun_of" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_error_class_valid" CHECK ("workflow_runs"."error_class" IN ('transient', 'rate_limited', 'timeout', 'permanent'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_error_class_status" CHECK ("workflow_runs"."error_class" IS NULL OR "workflow_runs"."status" IN ('failed', 'timed_out'));
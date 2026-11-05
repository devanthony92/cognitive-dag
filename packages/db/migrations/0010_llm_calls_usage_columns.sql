CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"attempt" integer NOT NULL,
	"repairs" smallint DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_node_id_format" CHECK ("llm_calls"."node_id" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "llm_calls_node_type_valid" CHECK ("llm_calls"."node_type" IN ('llm.classify', 'llm.extract', 'llm.generate')),
	CONSTRAINT "llm_calls_attempt_positive" CHECK ("llm_calls"."attempt" >= 1),
	CONSTRAINT "llm_calls_repairs_range" CHECK ("llm_calls"."repairs" BETWEEN 0 AND 2),
	CONSTRAINT "llm_calls_model_length" CHECK (char_length("llm_calls"."model") BETWEEN 1 AND 64),
	CONSTRAINT "llm_calls_reserved_tokens_non_negative" CHECK ("llm_calls"."reserved_tokens" >= 0),
	CONSTRAINT "llm_calls_input_tokens_non_negative" CHECK ("llm_calls"."input_tokens" >= 0),
	CONSTRAINT "llm_calls_output_tokens_non_negative" CHECK ("llm_calls"."output_tokens" >= 0),
	CONSTRAINT "llm_calls_cost_non_negative" CHECK ("llm_calls"."cost_micro_usd" >= 0),
	CONSTRAINT "llm_calls_outcome_valid" CHECK ("llm_calls"."outcome" IN ('succeeded', 'invalid_output', 'failed')),
	CONSTRAINT "llm_calls_error_code_length" CHECK (char_length("llm_calls"."error_code") <= 64),
	CONSTRAINT "llm_calls_error_code_consistent" CHECK (("llm_calls"."outcome" = 'succeeded' AND "llm_calls"."error_code" IS NULL)
        OR ("llm_calls"."outcome" <> 'succeeded' AND "llm_calls"."error_code" IS NOT NULL)),
	CONSTRAINT "llm_calls_duration_non_negative" CHECK ("llm_calls"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "llm_usage_daily" (
	"organization_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"tokens_used" bigint DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_daily_organization_id_usage_date_pk" PRIMARY KEY("organization_id","usage_date"),
	CONSTRAINT "llm_usage_daily_tokens_non_negative" CHECK ("llm_usage_daily"."tokens_used" >= 0),
	CONSTRAINT "llm_usage_daily_cost_non_negative" CHECK ("llm_usage_daily"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" DROP CONSTRAINT "workflow_run_steps_error_class_valid";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_error_class_valid";--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "llm_tokens_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_daily" ADD CONSTRAINT "llm_usage_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_run_node_idx" ON "llm_calls" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "llm_calls_organization_created_idx" ON "llm_calls" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_error_class_valid" CHECK ("workflow_run_steps"."error_class" IN ('transient', 'rate_limited', 'timeout', 'permanent', 'invalid_output', 'budget_exhausted'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_llm_tokens_used_non_negative" CHECK ("workflow_runs"."llm_tokens_used" >= 0);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_error_class_valid" CHECK ("workflow_runs"."error_class" IN ('transient', 'rate_limited', 'timeout', 'permanent', 'invalid_output', 'budget_exhausted'));
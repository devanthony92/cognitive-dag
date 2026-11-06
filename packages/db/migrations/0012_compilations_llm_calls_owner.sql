CREATE TABLE "compilations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid,
	"requested_by" uuid NOT NULL,
	"mode" text NOT NULL,
	"base_draft_revision" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"intent_chars" integer NOT NULL,
	"model" text NOT NULL,
	"calls" smallint DEFAULT 0 NOT NULL,
	"repairs" smallint DEFAULT 0 NOT NULL,
	"llm_tokens_used" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"node_count" smallint,
	"has_fallback" boolean DEFAULT false NOT NULL,
	"error_class" text,
	"error_code" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "compilations_mode_valid" CHECK ("compilations"."mode" IN ('create', 'regenerate')),
	CONSTRAINT "compilations_base_draft_revision_positive" CHECK ("compilations"."base_draft_revision" >= 1),
	CONSTRAINT "compilations_status_valid" CHECK ("compilations"."status" IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "compilations_intent_chars_range" CHECK ("compilations"."intent_chars" BETWEEN 1 AND 2000),
	CONSTRAINT "compilations_model_length" CHECK (char_length("compilations"."model") BETWEEN 1 AND 64),
	CONSTRAINT "compilations_calls_range" CHECK ("compilations"."calls" BETWEEN 0 AND 3),
	CONSTRAINT "compilations_repairs_range" CHECK ("compilations"."repairs" BETWEEN 0 AND 2),
	CONSTRAINT "compilations_llm_tokens_used_non_negative" CHECK ("compilations"."llm_tokens_used" >= 0),
	CONSTRAINT "compilations_cost_non_negative" CHECK ("compilations"."cost_micro_usd" >= 0),
	CONSTRAINT "compilations_node_count_non_negative" CHECK ("compilations"."node_count" >= 0),
	CONSTRAINT "compilations_error_class_valid" CHECK ("compilations"."error_class" IN ('transient', 'rate_limited', 'timeout', 'permanent', 'invalid_output', 'budget_exhausted')),
	CONSTRAINT "compilations_error_code_length" CHECK (char_length("compilations"."error_code") <= 64),
	CONSTRAINT "compilations_mode_consistent" CHECK (("compilations"."mode" = 'create' AND "compilations"."workflow_id" IS NULL AND "compilations"."base_draft_revision" IS NULL)
        OR ("compilations"."mode" = 'regenerate' AND "compilations"."workflow_id" IS NOT NULL AND "compilations"."base_draft_revision" IS NOT NULL)),
	CONSTRAINT "compilations_error_consistent" CHECK ((("compilations"."status" = 'failed') = ("compilations"."error_code" IS NOT NULL))
        AND ("compilations"."error_class" IS NULL OR "compilations"."status" = 'failed')),
	CONSTRAINT "compilations_finished_consistent" CHECK (("compilations"."finished_at" IS NOT NULL) = ("compilations"."status" IN ('succeeded', 'failed'))),
	CONSTRAINT "compilations_fallback_only_failed" CHECK ("compilations"."has_fallback" = false OR "compilations"."status" = 'failed')
);
--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_node_type_valid";--> statement-breakpoint
ALTER TABLE "llm_calls" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ALTER COLUMN "node_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "compilation_id" uuid;--> statement-breakpoint
ALTER TABLE "compilations" ADD CONSTRAINT "compilations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compilations" ADD CONSTRAINT "compilations_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compilations" ADD CONSTRAINT "compilations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compilations_organization_created_idx" ON "compilations" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "compilations_workflow_created_idx" ON "compilations" USING btree ("workflow_id","created_at" DESC NULLS LAST) WHERE "compilations"."workflow_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_compilation_id_compilations_id_fk" FOREIGN KEY ("compilation_id") REFERENCES "public"."compilations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_compilation_idx" ON "llm_calls" USING btree ("compilation_id") WHERE "llm_calls"."compilation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_owner_consistent" CHECK (("llm_calls"."run_id" IS NOT NULL AND "llm_calls"."node_id" IS NOT NULL AND "llm_calls"."compilation_id" IS NULL
          AND "llm_calls"."node_type" <> 'compiler')
        OR ("llm_calls"."run_id" IS NULL AND "llm_calls"."node_id" IS NULL AND "llm_calls"."compilation_id" IS NOT NULL
          AND "llm_calls"."node_type" = 'compiler'));--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_node_type_valid" CHECK ("llm_calls"."node_type" IN ('llm.classify', 'llm.extract', 'llm.generate', 'compiler'));
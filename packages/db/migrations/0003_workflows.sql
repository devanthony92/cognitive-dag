CREATE TABLE "organization_limits" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"max_nodes" integer NOT NULL,
	"max_edges" integer NOT NULL,
	"max_definition_bytes" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_limits_max_nodes" CHECK ("organization_limits"."max_nodes" BETWEEN 1 AND 500),
	CONSTRAINT "organization_limits_max_edges" CHECK ("organization_limits"."max_edges" BETWEEN 0 AND 1000),
	CONSTRAINT "organization_limits_max_definition_bytes" CHECK ("organization_limits"."max_definition_bytes" BETWEEN 1024 AND 1048576),
	CONSTRAINT "organization_limits_updated_by_length" CHECK (char_length("organization_limits"."updated_by") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "workflow_active_versions" (
	"workflow_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_id" uuid,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	CONSTRAINT "workflow_active_versions_activated_consistent" CHECK (("workflow_active_versions"."version_id" IS NULL) = ("workflow_active_versions"."activated_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_hash" "bytea" NOT NULL,
	"note" text,
	"node_count" integer NOT NULL,
	"edge_count" integer NOT NULL,
	"node_types" text[] NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_id_workflow_key" UNIQUE("id","workflow_id"),
	CONSTRAINT "workflow_versions_number_positive" CHECK ("workflow_versions"."version_number" >= 1),
	CONSTRAINT "workflow_versions_definition_size" CHECK (octet_length("workflow_versions"."definition"::text) <= 1048576),
	CONSTRAINT "workflow_versions_hash_length" CHECK (octet_length("workflow_versions"."definition_hash") = 32),
	CONSTRAINT "workflow_versions_note_length" CHECK (char_length("workflow_versions"."note") <= 500),
	CONSTRAINT "workflow_versions_node_count" CHECK ("workflow_versions"."node_count" >= 1),
	CONSTRAINT "workflow_versions_edge_count" CHECK ("workflow_versions"."edge_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"draft_definition" jsonb DEFAULT '{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"draft_updated_by" uuid NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workflows_name_length" CHECK (char_length("workflows"."name") BETWEEN 1 AND 100),
	CONSTRAINT "workflows_draft_definition_size" CHECK (octet_length("workflows"."draft_definition"::text) <= 1048576),
	CONSTRAINT "workflows_draft_revision_positive" CHECK ("workflows"."draft_revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "organization_limits" ADD CONSTRAINT "organization_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_active_versions" ADD CONSTRAINT "workflow_active_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_active_versions" ADD CONSTRAINT "workflow_active_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_active_versions" ADD CONSTRAINT "workflow_active_versions_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_active_versions" ADD CONSTRAINT "workflow_active_versions_version_fkey" FOREIGN KEY ("version_id","workflow_id") REFERENCES "public"."workflow_versions"("id","workflow_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_draft_updated_by_users_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_workflow_number_key" ON "workflow_versions" USING btree ("workflow_id","version_number");--> statement-breakpoint
CREATE INDEX "workflow_versions_node_types_idx" ON "workflow_versions" USING gin ("node_types");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_organization_name_active_key" ON "workflows" USING btree ("organization_id","name") WHERE "workflows"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflows_organization_active_idx" ON "workflows" USING btree ("organization_id") WHERE "workflows"."deleted_at" IS NULL;
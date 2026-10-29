CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."session_revoke_reason" AS ENUM('logout', 'password_change', 'password_reset', 'idle_timeout');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_normalized" CHECK ("invitations"."email" = lower(btrim("invitations"."email"))),
	CONSTRAINT "invitations_email_length" CHECK (char_length("invitations"."email") BETWEEN 3 AND 254),
	CONSTRAINT "invitations_token_hash_length" CHECK (octet_length("invitations"."token_hash") = 32),
	CONSTRAINT "invitations_accepted_consistent" CHECK ("invitations"."status" <> 'accepted' OR ("invitations"."accepted_by" IS NOT NULL AND "invitations"."accepted_at" IS NOT NULL)),
	CONSTRAINT "invitations_revoked_consistent" CHECK ("invitations"."status" <> 'revoked' OR "invitations"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "one_time_tokens_token_hash_length" CHECK (octet_length("one_time_tokens"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"is_personal" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_name_length" CHECK (char_length("organizations"."name") BETWEEN 1 AND 100),
	CONSTRAINT "organizations_personal_not_deleted" CHECK (NOT ("organizations"."is_personal" AND "organizations"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_token_hash" "bytea" NOT NULL,
	"ip" "inet" NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "session_revoke_reason",
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_length" CHECK (octet_length("sessions"."token_hash") = 32),
	CONSTRAINT "sessions_csrf_token_hash_length" CHECK (octet_length("sessions"."csrf_token_hash") = 32),
	CONSTRAINT "sessions_user_agent_length" CHECK (char_length("sessions"."user_agent") <= 512),
	CONSTRAINT "sessions_revocation_consistent" CHECK (("sessions"."revoked_at" IS NULL) = ("sessions"."revoke_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_email_length" CHECK (char_length("users"."email") BETWEEN 3 AND 254),
	CONSTRAINT "users_name_length" CHECK (char_length("users"."name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_key" ON "invitations" USING btree ("organization_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_user_active_key" ON "memberships" USING btree ("organization_id","user_id") WHERE "memberships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memberships_user_active_idx" ON "memberships" USING btree ("user_id") WHERE "memberships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_personal_key" ON "organizations" USING btree ("created_by") WHERE "organizations"."is_personal" AND "organizations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_key" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;
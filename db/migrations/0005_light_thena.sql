CREATE TABLE "impersonation_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer,
	"admin_email" text NOT NULL,
	"admin_clerk_user_id" text,
	"workspace_id" integer,
	"workspace_name" text NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text
);
--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impersonation_sessions_workspace_idx" ON "impersonation_sessions" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonation_sessions_admin_idx" ON "impersonation_sessions" USING btree ("admin_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonation_sessions_started_idx" ON "impersonation_sessions" USING btree ("started_at");
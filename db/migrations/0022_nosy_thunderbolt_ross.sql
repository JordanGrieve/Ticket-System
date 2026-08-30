CREATE TABLE "admin_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_admin_id" integer,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_id" integer,
	"target_label" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at");
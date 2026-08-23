CREATE TABLE "ingestion_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"key_prefix" text NOT NULL,
	"workspace_id" integer,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_failures" ADD CONSTRAINT "ingestion_failures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_failures_reason_key_idx" ON "ingestion_failures" USING btree ("reason","key_prefix");--> statement-breakpoint
CREATE INDEX "ingestion_failures_last_seen_idx" ON "ingestion_failures" USING btree ("last_seen_at");
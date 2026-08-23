ALTER TABLE "tickets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "snoozed_by" text;--> statement-breakpoint
CREATE INDEX "tickets_archived_idx" ON "tickets" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "tickets_snoozed_idx" ON "tickets" USING btree ("workspace_id","snoozed_until");
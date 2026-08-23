ALTER TABLE "tickets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "tickets_deleted_idx" ON "tickets" USING btree ("deleted_at");
CREATE TABLE "feedback_drops" (
	"id" serial PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"event_type" text NOT NULL,
	"last_message_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_drops_reason_event_idx" ON "feedback_drops" USING btree ("reason","event_type");--> statement-breakpoint
CREATE INDEX "feedback_drops_last_seen_idx" ON "feedback_drops" USING btree ("last_seen_at");
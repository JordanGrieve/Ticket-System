CREATE TABLE "auto_reply_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"headers" jsonb,
	"reason" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_reply_queue" ADD CONSTRAINT "auto_reply_queue_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_queue" ADD CONSTRAINT "auto_reply_queue_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_reply_queue_ticket_idx" ON "auto_reply_queue" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "auto_reply_queue_due_idx" ON "auto_reply_queue" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "auto_reply_queue_workspace_idx" ON "auto_reply_queue" USING btree ("workspace_id");
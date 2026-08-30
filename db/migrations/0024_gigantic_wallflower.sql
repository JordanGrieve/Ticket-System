CREATE TABLE "impersonation_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impersonation_reads" ADD CONSTRAINT "impersonation_reads_session_id_impersonation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."impersonation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "impersonation_reads_session_ticket_idx" ON "impersonation_reads" USING btree ("session_id","ticket_id");
ALTER TABLE "tickets" ADD COLUMN "reply_token" text;--> statement-breakpoint
CREATE INDEX "ticket_messages_message_id_idx" ON "ticket_messages" USING btree ("message_id");
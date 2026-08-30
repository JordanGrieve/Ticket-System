ALTER TABLE "admin_actions" ADD COLUMN "chain_prev_hash" text;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "chain_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_actions_chain_prev_idx" ON "admin_actions" USING btree ("chain_prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_actions_chain_hash_idx" ON "admin_actions" USING btree ("chain_hash");
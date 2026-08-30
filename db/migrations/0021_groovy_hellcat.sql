ALTER TABLE "impersonation_sessions" ADD COLUMN "chain_prev_hash" text;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD COLUMN "chain_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "impersonation_sessions_chain_prev_idx" ON "impersonation_sessions" USING btree ("chain_prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "impersonation_sessions_chain_hash_idx" ON "impersonation_sessions" USING btree ("chain_hash");
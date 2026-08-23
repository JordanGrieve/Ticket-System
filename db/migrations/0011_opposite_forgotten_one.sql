ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
-- Backfill: the earliest agent row in each workspace becomes its owner.
--
-- Without this every existing workspace has no owner at all, and the removal
-- guard this column exists for would silently protect nobody — the worst kind
-- of security change, the one that looks done.
--
-- Earliest-id is the best available answer to "who is this workspace actually
-- for": rows are only ever appended, and the first was created when the
-- workspace was, by db/bootstrap, db/seed or the operator onboarding a client.
-- Invitees are always later rows.
--
-- DISTINCT ON is evaluated once against the pre-update table, so this cannot
-- promote two agents in the same workspace even if it were re-run.
UPDATE "agents" SET "role" = 'owner'
WHERE "id" IN (
  SELECT DISTINCT ON ("workspace_id") "id"
  FROM "agents"
  ORDER BY "workspace_id", "id" ASC
);

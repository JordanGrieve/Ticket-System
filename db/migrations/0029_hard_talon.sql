ALTER TABLE "impersonation_sessions" DROP CONSTRAINT "impersonation_sessions_admin_id_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "impersonation_sessions" DROP CONSTRAINT "impersonation_sessions_workspace_id_workspaces_id_fk";
--> statement-breakpoint
-- ── ONE-OFF REPAIR OF THE ROWS THE OLD CASCADE ALREADY BROKE ──
--
-- Dropping the constraints above stops this happening again. It cannot undo
-- what already happened: deleting the "E2E Test Bakery" workspace (id 25) on
-- 11 Sep 2026 set workspace_id to NULL on the three sessions that had entered
-- it, and workspace_id is sealed by the hash chain, so the console reports
-- CHAIN BROKEN at session #59 and will go on reporting it forever.
--
-- This puts the original value back. It is a RESTORE, not a re-hash: every
-- chain_hash is left exactly as written. That distinction is the whole reason
-- this is safe to do to an audit log --- the hashes are the evidence, and they
-- are untouched. If 25 is the wrong id, the recomputed hash still will not
-- match and the console stays red. The repair cannot manufacture a verified
-- chain; it can only reveal whether the value it restored was the true one.
--
-- Scoped three ways so it can affect nothing else: only rows already NULL
-- (i.e. only rows the cascade already broke), only rows whose frozen
-- workspace_name snapshot names that workspace, and only where no workspace
-- row with that id exists any more. In every other environment it matches
-- nothing and is a no-op.
UPDATE "impersonation_sessions"
SET "workspace_id" = 25
WHERE "workspace_id" IS NULL
  AND "workspace_name" = 'E2E Test Bakery'
  AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 25);

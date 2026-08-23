ALTER TABLE "workspaces" ADD COLUMN "plan" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
-- Grandfather every workspace that existed before billing did.
--
-- Without this, the DEFAULT 'trial' above silently enrols the pilot client in
-- a fourteen-day trial starting the moment this migration runs. Two weeks
-- later a real business that was invited personally, and never agreed to a
-- trial, loses the ability to send. That is not a billing decision anybody
-- made; it is a default leaking into production.
--
-- They go to 'business' with NO Stripe subscription, which lib/trial.ts reads
-- as comped: entitled to everything, never expiring, nothing owed. That state
-- is deliberate and named rather than accidental — an operator comping a
-- workspace is a thing that will be wanted again.
--
-- Scoped by created_at so this only ever touches rows that predate the column.
-- Anyone signing up after this runs gets the trial the default gives them.
UPDATE "workspaces"
SET "plan" = 'business',
    "subscription_status" = NULL,
    "stripe_subscription_id" = NULL
WHERE "created_at" < now();

ALTER TABLE "welcome_emails" ALTER COLUMN "enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "welcome_emails" ADD COLUMN "template_key" text DEFAULT 'branded' NOT NULL;--> statement-breakpoint
ALTER TABLE "welcome_emails" ADD COLUMN "hero_image_url" text;--> statement-breakpoint
ALTER TABLE "welcome_emails" ADD COLUMN "hero_image_alt" text;--> statement-breakpoint
ALTER TABLE "welcome_emails" ADD COLUMN "products" jsonb;
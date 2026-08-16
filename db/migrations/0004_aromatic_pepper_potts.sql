CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "auto_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"out_of_hours_body" text,
	"delay" text DEFAULT 'immediate' NOT NULL,
	"schedule_mode" text DEFAULT 'always' NOT NULL,
	"business_hours" jsonb,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"skip_if_teammate_replied" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"subscriber_id" integer,
	"email" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"template_key" text NOT NULL,
	"body" text NOT NULL,
	"list_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'tag_a' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_subscribers" (
	"list_id" integer NOT NULL,
	"subscriber_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_subscribers_list_id_subscriber_id_pk" PRIMARY KEY("list_id","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"domain" text NOT NULL,
	"dkim_selector" text,
	"spf_status" text DEFAULT 'pending' NOT NULL,
	"dkim_status" text DEFAULT 'pending' NOT NULL,
	"dmarc_status" text DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'subscribed' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"source" text,
	"consent_method" text,
	"consent_at" timestamp with time zone,
	"consent_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_labels" (
	"ticket_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_labels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_reads" (
	"ticket_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_reads_ticket_id_agent_id_pk" PRIMARY KEY("ticket_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_stars" (
	"ticket_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_stars_ticket_id_agent_id_pk" PRIMARY KEY("ticket_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "form_id" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_replies" ADD CONSTRAINT "auto_replies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_subscribers" ADD CONSTRAINT "list_subscribers_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_subscribers" ADD CONSTRAINT "list_subscribers_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_stars" ADD CONSTRAINT "ticket_stars_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_stars" ADD CONSTRAINT "ticket_stars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_replies_workspace_idx" ON "auto_replies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_subscriber_idx" ON "campaign_recipients" USING btree ("campaign_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_provider_message_id_idx" ON "campaign_recipients" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_subscriber_idx" ON "campaign_recipients" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_idx" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_idx" ON "campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "forms_workspace_idx" ON "forms" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_key_idx" ON "forms" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_workspace_name_idx" ON "labels" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "list_subscribers_subscriber_idx" ON "list_subscribers" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_workspace_name_idx" ON "lists" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_workspace_domain_idx" ON "sending_domains" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_workspace_email_idx" ON "subscribers" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "subscribers_workspace_status_idx" ON "subscribers" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_workspace_email_idx" ON "suppressions" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "ticket_labels_label_idx" ON "ticket_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "ticket_reads_agent_idx" ON "ticket_reads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ticket_stars_agent_idx" ON "ticket_stars" USING btree ("agent_id","created_at");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_form_idx" ON "tickets" USING btree ("form_id");
import type { ConsentMethod, SubscriberStatus } from "@/db/schema";

/**
 * Display strings for the two mailer unions, shared by the list and the detail
 * page.
 *
 * Its own file rather than an export from page.tsx: a page module may only
 * export the default component and Next's own reserved names, so a shared
 * constant living there is an invalid export.
 *
 * Written as Record<Union, string>, so widening either union in db/schema.ts
 * fails typecheck here rather than silently rendering a raw database value.
 */
export const STATUS_LABEL: Record<SubscriberStatus, string> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Complained",
};

/**
 * How the consent was captured, in the words you would use to a regulator.
 * "import" and "manual" are described honestly — neither is evidence of
 * anything on its own, which is the point of naming them differently from the
 * two that are.
 */
export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  signup_form: "Signup form",
  checkout: "Checkout opt-in",
  api: "API",
  import: "Imported from another system",
  manual: "Added by hand",
};

/** Methods that carry no first-party proof of the opt-in by themselves. */
export const WEAK_CONSENT_METHODS: ConsentMethod[] = ["import", "manual"];

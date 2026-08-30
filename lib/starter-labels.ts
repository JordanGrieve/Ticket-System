import type { LabelColor } from "@/db/schema";

/**
 * Its own module because lib/labels.ts is `server-only` — it imports the
 * database — and the label manager that offers this set is a client
 * component. A type-only import of LabelColor is erased at compile time, so
 * nothing here reaches the server bundle.
 */

/**
 * The set offered on the empty label screen.
 *
 * ── WHY A DEFAULT SET AT ALL ──
 * From the onboarding research: a blank field asks a time-poor non-expert to
 * do creative work at the moment they have the least context, and a default
 * turns creation into editing, which is far cheaper. A label manager showing
 * "No labels yet" is that blank field — it explains the mechanism and offers
 * no opinion about what anybody should actually use it for.
 *
 * ── WHY IT IS OFFERED AND NOT SEEDED ──
 * Seeding these at workspace creation would be less work and worse. It would
 * reach only NEW workspaces, so the pilot client — the one person whose
 * onboarding we can actually watch — would never see it; and four labels
 * appearing unasked in a shared inbox is somebody else's filing system turning
 * up in your workspace. One button, pressed on purpose, is reversible in a way
 * a migration is not.
 *
 * The names are the ones the research suggested. They are a starting point to
 * rename, which is why the screen says so rather than presenting them as
 * correct.
 */
export const STARTER_LABELS: { name: string; color: LabelColor }[] = [
  { name: "Orders", color: "tag_a" },
  { name: "Enquiries", color: "tag_b" },
  { name: "Wholesale", color: "tag_c" },
  { name: "Complaints", color: "tag_a" },
];

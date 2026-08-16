import type { TicketSource, TicketStatus } from "@/db/schema";

/**
 * Design tokens for the mailer product.
 *
 * Everything here returns CSS custom properties rather than literal hex, so the
 * six themes in globals.css recolour badges and dots for free. Returning hex
 * from this module was what previously pinned the UI to terracotta regardless
 * of theme.
 */

/** Source badge + dot styling. */
export const SOURCE_META: Record<
  TicketSource,
  { label: string; fg: string; bg: string; dot: string }
> = {
  order: {
    label: "Order",
    fg: "var(--tag-c-fg)",
    bg: "var(--tag-c-bg)",
    dot: "var(--tag-c-fg)",
  },
  email: {
    label: "Email",
    fg: "var(--tag-b-fg)",
    bg: "var(--tag-b-bg)",
    dot: "var(--tag-b-fg)",
  },
  contact_form: {
    label: "Contact form",
    fg: "var(--tag-a-fg)",
    bg: "var(--tag-a-bg)",
    dot: "var(--tag-a-fg)",
  },
};

/** Status dot + label styling. */
export const STATUS_META: Record<
  TicketStatus,
  { label: string; fg: string; dot: string }
> = {
  open: { label: "Open", fg: "var(--ok-fg)", dot: "var(--ok-fg)" },
  in_progress: {
    label: "In progress",
    fg: "var(--warn-fg)",
    dot: "var(--warn-fg)",
  },
  closed: { label: "Closed", fg: "var(--muted)", dot: "var(--muted)" },
};

export const STATUS_ORDER: TicketStatus[] = ["open", "in_progress", "closed"];

/**
 * The six themes from the design. "system" is the absence of a data-theme
 * attribute — globals.css falls back to prefers-color-scheme in that case — so
 * it deliberately has no palette entry here.
 */
export const THEMES = [
  { key: "system", label: "System", note: "Match my device" },
  { key: "light", label: "Light", note: "Lavender, always light" },
  { key: "dark", label: "Dark", note: "Purple ink" },
  { key: "forest", label: "Forest", note: "Deep green" },
  { key: "slate", label: "Slate", note: "Neutral with amber" },
  { key: "ocean", label: "Ocean", note: "Midnight blue" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

const THEME_KEYS = new Set<string>(THEMES.map((t) => t.key));

/**
 * Resolve a stored preference to the value of the root data-theme attribute.
 * Returns undefined for "system" and for anything unrecognised, which leaves the
 * attribute off and lets prefers-color-scheme decide.
 */
export function themeAttr(key: string | null | undefined): string | undefined {
  if (!key || key === "system" || !THEME_KEYS.has(key)) return undefined;
  return key;
}


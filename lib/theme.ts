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
 * TWO themes, from 9 Sep 2026. There were six — light, dark, forest, slate,
 * ocean and "system" — and Jordan cut them to the pair: "it will just be
 * light or dark (the purple is the dark one)". Four palettes were four sets
 * of contrast pairs to keep at AAA for a product with one client, and every
 * new surface had to be checked six times.
 *
 * "System" went with them. It resolved to light or dark from the device, so
 * nothing is lost that the two cannot express, and a signed-in workspace now
 * always carries an explicit data-theme — see themeAttr.
 */
export const THEMES = [
  { key: "light", label: "Light", note: "Lavender, always light" },
  { key: "dark", label: "Dark", note: "Purple ink" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

/**
 * Resolve a stored preference to the value of the root data-theme attribute.
 *
 * Never undefined: a workspace is always light or dark. Anything that is not
 * "light" — the legacy "terracotta" the column defaults to, a retired
 * "forest", "system" — is dark, because dark is the palette every existing
 * workspace was looking at. Pages with no workspace (marketing, the public
 * forms) never call this and follow prefers-color-scheme in globals.css.
 */
export function themeAttr(key: string | null | undefined): ThemeKey {
  return key === "light" ? "light" : "dark";
}


import type { TicketSource, TicketStatus } from "@/db/schema";

/** Source badge + dot styling, mirrored from the design mockup. */
export const SOURCE_META: Record<
  TicketSource,
  { label: string; fg: string; bg: string; dot: string }
> = {
  order: { label: "Order", fg: "#b4491f", bg: "#fbe9df", dot: "#d6552f" },
  email: { label: "Email", fg: "#2f5fb0", bg: "#e7effb", dot: "#3b6fd4" },
  contact_form: {
    label: "Contact form",
    fg: "#2c7a54",
    bg: "#e6f2ec",
    dot: "#1f9d6b",
  },
};

/** Status dot + label styling. */
export const STATUS_META: Record<
  TicketStatus,
  { label: string; fg: string; dot: string }
> = {
  open: { label: "Open", fg: "#2c7a54", dot: "#2c7a54" },
  in_progress: { label: "In progress", fg: "#b07d1a", dot: "#d99b2b" },
  closed: { label: "Closed", fg: "#9a9284", dot: "#b8ac98" },
};

export const STATUS_ORDER: TicketStatus[] = ["open", "in_progress", "closed"];

/** Per-workspace accent schemes (cosmetic). */
export const ACCENT_SCHEMES: Record<
  string,
  { label: string; accent: string; strong: string; soft: string; line: string }
> = {
  terracotta: {
    label: "Terracotta",
    accent: "#d6552f",
    strong: "#ab441f",
    soft: "#f9e7de",
    line: "#f1dacd",
  },
  rose: {
    label: "Clay rose",
    accent: "#c1566a",
    strong: "#9e4053",
    soft: "#f8e6ea",
    line: "#f0d3da",
  },
  amber: {
    label: "Amber",
    accent: "#c1841c",
    strong: "#9a6710",
    soft: "#f8ecd4",
    line: "#efe0bf",
  },
  sage: {
    label: "Sage",
    accent: "#4f8a5f",
    strong: "#3c6e49",
    soft: "#e3f0e6",
    line: "#d3e5d7",
  },
  ocean: {
    label: "Ocean",
    accent: "#2f77b5",
    strong: "#245d8f",
    soft: "#e2eef8",
    line: "#cfe0ef",
  },
  slate: {
    label: "Slate",
    accent: "#5b6472",
    strong: "#454c57",
    soft: "#eceef1",
    line: "#dde0e5",
  },
};

export function accentVars(schemeKey: string): Record<string, string> {
  const s = ACCENT_SCHEMES[schemeKey] ?? ACCENT_SCHEMES.terracotta;
  return {
    "--accent": s.accent,
    "--accent-strong": s.strong,
    "--accent-soft": s.soft,
    "--accent-line": s.line,
  };
}

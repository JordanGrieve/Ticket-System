import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  labels,
  ticketLabels,
  tickets,
  type Label,
  type LabelColor,
} from "@/db/schema";

/**
 * Coloured labels, and their assignment to tickets.
 *
 * TENANCY. `labels` carries `workspace_id`; `ticket_labels` deliberately does
 * not — it inherits tenancy from BOTH of its parents. Every read here filters
 * `labels.workspace_id` and/or joins up to `tickets` and filters
 * `tickets.workspace_id`; every write is expressed so the workspace predicate
 * is part of the statement that mutates the row, not a check performed
 * beforehand that a concurrent request could invalidate. An assignment is only
 * ever created when the ticket AND the label both belong to the same
 * workspace, so a caller cannot staple another tenant's label onto a ticket
 * even if it guesses both ids.
 *
 * COLOUR. `color` is a design-token key, never a hex value. It is turned into
 * paint by `[data-color]` rules in app/mail.css that resolve --tag-*-bg /
 * --tag-*-fg, so a label recolours with the six themes instead of pinning
 * itself to one palette.
 */

export const LABEL_COLORS: LabelColor[] = ["tag_a", "tag_b", "tag_c"];

/**
 * Names for the colour swatches in the picker.
 *
 * Deliberately not "Green" / "Violet" / "Amber": the same token is green in
 * one theme and amber in another, so a hue name would be wrong five times out
 * of six. These are positional, which is the only thing that stays true.
 */
export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  tag_a: "Colour one",
  tag_b: "Colour two",
  tag_c: "Colour three",
};

export const LABEL_NAME_MAX = 40;

export function isLabelColor(value: unknown): value is LabelColor {
  return (LABEL_COLORS as string[]).includes(value as string);
}

/** Trim and cap. Returns null when nothing usable is left. */
/**
 * A colour the user picked, normalised to #rrggbb, or null.
 *
 * ── STRICT ON PURPOSE ──
 * This value is interpolated into a CSS custom property on the element, so it
 * is the one place a label could carry something that is not a colour into a
 * style attribute. Only six hex digits are accepted: no named colours, no
 * rgb(), no var(), no url(). A rejected value falls back to the token, which
 * always renders.
 *
 * Three-digit hex is expanded rather than refused — every native colour input
 * emits six, but a hand-written #f00 is a reasonable thing to mean.
 */
export function normaliseLabelHex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  return null;
}

export function normaliseLabelName(raw: unknown): string | null {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LABEL_NAME_MAX);
  return name || null;
}

/** One label as the UI draws it. */
export type LabelChip = {
  id: number;
  name: string;
  color: LabelColor;
  /** A picked colour, or null to use the theme token in `color`. */
  colorHex: string | null;
};

export type LabelWithCount = LabelChip & {
  /** Tickets in THIS workspace carrying this label. */
  ticketCount: number;
};

// ── Reads ────────────────────────────────────────────────────────

/** A workspace's labels, alphabetical (the sidebar and picker order). */
export async function listLabels(workspaceId: number): Promise<LabelChip[]> {
  return db
    .select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
      colorHex: labels.colorHex,
    })
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.name));
}

/**
 * The same list with per-label ticket counts for the sidebar.
 *
 * The correlated subquery joins ticket_labels up to tickets and filters
 * `t.workspace_id` there — ticket_labels alone cannot tell you whose ticket it
 * is, so counting it unjoined would count other tenants' rows.
 */
export async function listLabelsWithCounts(
  workspaceId: number,
): Promise<LabelWithCount[]> {
  return db
    .select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
      colorHex: labels.colorHex,
      // `labels.id` is written out rather than interpolated as a Drizzle
      // column: in a plain single-table select Drizzle renders the column
      // UNQUALIFIED ("id"), and inside this subquery an unqualified "id" binds
      // to the joined `tickets` instead — comparing a label id to a ticket id
      // and silently counting nothing. Naming the outer table removes the
      // ambiguity; the inner tables are aliased so nothing else can collide.
      ticketCount: sql<number>`(
        SELECT count(*)::int
        FROM ticket_labels tl
        JOIN tickets t ON t.id = tl.ticket_id
        WHERE tl.label_id = labels.id
          AND t.workspace_id = ${workspaceId}
      )`,
    })
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.name));
}

/**
 * Labels for a set of tickets, as `ticketId -> chips`. One round trip for a
 * whole list page rather than a query per row.
 */
export async function labelsForTickets(
  workspaceId: number,
  ticketIds: number[],
): Promise<Map<number, LabelChip[]>> {
  const out = new Map<number, LabelChip[]>();
  if (ticketIds.length === 0) return out;

  // Both parents are filtered: the ticket must be this workspace's, and so
  // must the label. Either one alone would already be enough; both together
  // mean a mis-set row could not leak through this read.
  const rows = await db
    .select({
      ticketId: ticketLabels.ticketId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
      colorHex: labels.colorHex,
    })
    .from(ticketLabels)
    .innerJoin(tickets, eq(tickets.id, ticketLabels.ticketId))
    .innerJoin(labels, eq(labels.id, ticketLabels.labelId))
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(labels.workspaceId, workspaceId),
        inArray(tickets.id, ticketIds),
      ),
    )
    .orderBy(asc(labels.name));

  for (const r of rows) {
    const list = out.get(r.ticketId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color, colorHex: r.colorHex });
    out.set(r.ticketId, list);
  }
  return out;
}

/** Labels on one ticket. Empty when the ticket isn't this workspace's. */
export async function labelsForTicket(
  workspaceId: number,
  ticketId: number,
): Promise<LabelChip[]> {
  const byTicket = await labelsForTickets(workspaceId, [ticketId]);
  return byTicket.get(ticketId) ?? [];
}

// ── Label writes ─────────────────────────────────────────────────

/**
 * Create a label. Returns null when the name is already taken in this
 * workspace — the unique index is (workspace_id, name), so two tenants may
 * both have an "Urgent".
 */
export async function createLabel(
  workspaceId: number,
  name: string,
  color: LabelColor,
  colorHex: string | null = null,
): Promise<Label | null> {
  const [created] = await db
    .insert(labels)
    .values({ workspaceId, name, color, colorHex })
    .onConflictDoNothing()
    .returning();
  return created ?? null;
}

/**
 * The three labels a brand new workspace starts with.
 *
 * ── A BLANK FIELD ASKS FOR CREATIVE WORK AT THE MOMENT OF LEAST CONTEXT ──
 * The onboarding research is blunt about this: a default converts creation
 * into editing, which is far cheaper for a time-poor owner who has never used
 * the product. An empty label picker offers no clue that labels are for
 * sorting an inbox at all, so most people close it and never come back.
 *
 * ── WHY THREE, AND WHY THESE THREE ──
 * The research suggested a fourth, "Wholesale". It is left out: it fits a
 * bakery and not a plumber, and a default half our clients delete is the
 * clutter that makes people distrust the other defaults. These three are
 * unambiguous for any small business that answers its own email.
 *
 * Three also happens to be the number of colour tokens, so a new workspace
 * shows each swatch exactly once. That is a demonstration of the picker, not a
 * coincidence worth preserving if a fourth label is ever genuinely wanted —
 * colours may repeat.
 *
 * These are ordinary labels. Nothing marks them as seeded, nothing restores
 * them, and deleting one is final, which is the correct behaviour for a
 * suggestion.
 */
export const STARTER_LABELS: { name: string; color: LabelColor }[] = [
  { name: "Orders", color: "tag_a" },
  { name: "Enquiries", color: "tag_b" },
  { name: "Complaints", color: "tag_c" },
];

/**
 * Give a new workspace its starter labels. One statement, not three.
 *
 * Best effort by contract: the caller is provisionWorkspace, and the workspace
 * and its first agent are already committed by the time this runs. Losing a
 * workspace over three decorative rows would be a far worse failure than
 * starting without them, so the caller swallows the error rather than
 * unwinding a half-created account it has no transaction to unwind with.
 *
 * onConflictDoNothing so it can never be the thing that fails: a workspace
 * that somehow already has an "Orders" keeps the one it has.
 */
export async function seedStarterLabels(workspaceId: number): Promise<void> {
  await db
    .insert(labels)
    .values(STARTER_LABELS.map((l) => ({ workspaceId, ...l })))
    .onConflictDoNothing();
}

/** Rename / recolour. Null when the id isn't this workspace's. */
export async function updateLabel(
  workspaceId: number,
  labelId: number,
  patch: { name?: string; color?: LabelColor; colorHex?: string | null },
): Promise<Label | null> {
  if (
    patch.name === undefined &&
    patch.color === undefined &&
    patch.colorHex === undefined
  ) {
    return null;
  }
  const [updated] = await db
    .update(labels)
    .set(patch)
    .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
    .returning();
  return updated ?? null;
}

/**
 * Delete a label. Its ticket_labels rows go with it (ON DELETE CASCADE) — the
 * tickets themselves are untouched. False when the id isn't this workspace's.
 */
export async function deleteLabel(
  workspaceId: number,
  labelId: number,
): Promise<boolean> {
  const deleted = await db
    .delete(labels)
    .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
    .returning({ id: labels.id });
  return deleted.length > 0;
}

// ── Assignment ───────────────────────────────────────────────────

/**
 * Put a label on a ticket, or take it off.
 *
 * Returns null when the ticket and the label are not BOTH in `workspaceId`.
 * The workspace predicate lives inside the mutating statement:
 *
 *   INSERT … SELECT t.id, l.id FROM tickets t, labels l
 *   WHERE t.id = $ticket AND l.id = $label
 *     AND t.workspace_id = $ws AND l.workspace_id = $ws
 *
 * so a request naming another tenant's ticket inserts zero rows rather than
 * passing a check and then writing. The delete is filtered the same way.
 */
export async function setTicketLabel(
  workspaceId: number,
  ticketId: number,
  labelId: number,
  on: boolean,
): Promise<boolean | null> {
  if (on) {
    const res = await db.execute(sql`
      INSERT INTO ticket_labels (ticket_id, label_id)
      SELECT t.id, l.id
      FROM tickets t, labels l
      WHERE t.id = ${ticketId}
        AND l.id = ${labelId}
        AND t.workspace_id = ${workspaceId}
        AND l.workspace_id = ${workspaceId}
      ON CONFLICT (ticket_id, label_id) DO UPDATE
        SET created_at = ticket_labels.created_at
      RETURNING ticket_id
    `);
    // DO UPDATE (a no-op touch) rather than DO NOTHING so an already-labelled
    // ticket still RETURNs a row — otherwise "already on" is indistinguishable
    // from "wrong workspace", and we would report a cross-tenant error for a
    // double click.
    return res.rows.length > 0 ? true : null;
  }

  const res = await db.execute(sql`
    DELETE FROM ticket_labels tl
    USING tickets t, labels l
    WHERE tl.ticket_id = t.id
      AND tl.label_id = l.id
      AND tl.ticket_id = ${ticketId}
      AND tl.label_id = ${labelId}
      AND t.workspace_id = ${workspaceId}
      AND l.workspace_id = ${workspaceId}
    RETURNING tl.ticket_id
  `);
  if (res.rows.length > 0) return false;

  // Nothing deleted: either it was already off, or the ids aren't ours. Only
  // the second is an error, so establish which.
  const [owned] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.workspaceId, workspaceId)))
    .limit(1);
  return owned ? false : null;
}

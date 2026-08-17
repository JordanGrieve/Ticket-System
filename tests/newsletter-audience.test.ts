import { describe, it, expect } from "vitest";
import {
  selectAudience,
  type AudienceCandidate,
} from "../lib/newsletter";

/**
 * Audience materialisation is where a newsletter feature does its real damage.
 * Every case below is a way to mail somebody you must not mail, or to mail
 * somebody twice — both of which end as a spam complaint, and on a shared
 * sending domain a spam complaint is charged to every other tenant's support
 * mail as well.
 *
 * Pure: no DATABASE_URL. The DB layer (lib/campaign-send.ts) fetches rows and
 * hands them to this exact function, so what is proved here is what ships.
 */

function sub(
  id: number,
  email: string,
  overrides: Partial<AudienceCandidate> = {},
): AudienceCandidate {
  return {
    subscriberId: id,
    email,
    name: null,
    status: "subscribed",
    ...overrides,
  };
}

describe("suppression filtering", () => {
  it("skips a suppressed address even when the subscriber says 'subscribed'", () => {
    // suppressions is keyed by EMAIL and outranks the subscriber row: a
    // re-imported CSV must not resurrect someone who reported us for spam.
    const r = selectAudience(
      [sub(1, "a@x.com"), sub(2, "b@x.com")],
      ["b@x.com"],
    );
    expect(r.members.map((m) => m.email)).toEqual(["a@x.com"]);
    expect(r.skipped.suppressed).toBe(1);
  });

  it("matches suppressions case-insensitively in both directions", () => {
    const r = selectAudience([sub(1, "Bob@Example.COM")], ["bob@example.com"]);
    expect(r.members).toHaveLength(0);
    expect(r.skipped.suppressed).toBe(1);

    const r2 = selectAudience([sub(1, "bob@example.com")], ["BOB@EXAMPLE.COM"]);
    expect(r2.members).toHaveLength(0);
  });

  it("does not treat a plus-tagged address as suppressed by its base", () => {
    // bob+news@ is a different mailbox from bob@. Folding them would block
    // someone who never asked to be blocked.
    const r = selectAudience([sub(1, "bob+news@x.com")], ["bob@x.com"]);
    expect(r.members).toHaveLength(1);
  });

  it("suppression beats every subscriber status, and is counted once", () => {
    const r = selectAudience(
      [sub(1, "a@x.com", { status: "unsubscribed" })],
      ["a@x.com"],
    );
    expect(r.skipped.suppressed).toBe(1);
    expect(r.skipped.unsubscribed).toBe(0);
    expect(r.skippedTotal).toBe(1);
  });

  it("handles an empty suppression list without blocking anybody", () => {
    const r = selectAudience([sub(1, "a@x.com")], []);
    expect(r.members).toHaveLength(1);
    expect(r.skippedTotal).toBe(0);
  });
});

describe("subscriber status filtering", () => {
  it("mails only 'subscribed', and reports the other reasons separately", () => {
    const r = selectAudience(
      [
        sub(1, "ok@x.com"),
        sub(2, "left@x.com", { status: "unsubscribed" }),
        sub(3, "gone@x.com", { status: "bounced" }),
        sub(4, "angry@x.com", { status: "complained" }),
      ],
      [],
    );
    expect(r.members.map((m) => m.email)).toEqual(["ok@x.com"]);
    expect(r.skipped.unsubscribed).toBe(1);
    expect(r.skipped.bounced).toBe(1);
    expect(r.skipped.complained).toBe(1);
    expect(r.skippedTotal).toBe(3);
  });
});

describe("dedup across overlapping segments", () => {
  it("sends once when the same subscriber appears in several lists", () => {
    // "All customers" ∪ "Newsletter" ∪ "Beta" — the same person, three rows.
    const r = selectAudience(
      [sub(7, "a@x.com"), sub(7, "a@x.com"), sub(7, "a@x.com")],
      [],
    );
    expect(r.members).toHaveLength(1);
    expect(r.skipped.duplicate).toBe(2);
  });

  it("dedups by address too, not just subscriber id", () => {
    // subscribers is unique on (workspace_id, email) at the index level, which
    // is case-sensitive — so two rows can point at one real mailbox.
    const r = selectAudience([sub(1, "Bob@x.com"), sub(2, "bob@x.com")], []);
    expect(r.members).toHaveLength(1);
    expect(r.members[0].email).toBe("bob@x.com");
    expect(r.skipped.duplicate).toBe(1);
  });

  it("counts PEOPLE, not rows: a suppressed duplicate is one suppression", () => {
    // Dedup runs before filtering precisely so the composer doesn't tell a
    // client it is skipping 300 people when the real figure is 100.
    const r = selectAudience(
      [sub(1, "a@x.com"), sub(1, "a@x.com"), sub(1, "a@x.com")],
      ["a@x.com"],
    );
    expect(r.skipped.suppressed).toBe(1);
    expect(r.skipped.duplicate).toBe(2);
    expect(r.members).toHaveLength(0);
  });

  it("keeps the first occurrence's name", () => {
    const r = selectAudience(
      [
        sub(1, "a@x.com", { name: "Alex" }),
        sub(1, "a@x.com", { name: "Alexandra" }),
      ],
      [],
    );
    expect(r.members[0].name).toBe("Alex");
  });
});

describe("malformed addresses", () => {
  it("drops junk before dedup, so repeated junk isn't miscounted", () => {
    const r = selectAudience(
      [sub(1, "not-an-email"), sub(2, ""), sub(3, "   "), sub(4, "ok@x.com")],
      [],
    );
    expect(r.members.map((m) => m.email)).toEqual(["ok@x.com"]);
    expect(r.skipped.invalid_email).toBe(3);
    expect(r.skipped.duplicate).toBe(0);
  });
});

describe("selection bookkeeping", () => {
  it("accounts for every candidate exactly once", () => {
    const candidates = [
      sub(1, "a@x.com"),
      sub(2, "b@x.com", { status: "unsubscribed" }),
      sub(3, "c@x.com"),
      sub(3, "c@x.com"),
      sub(4, "bad"),
      sub(5, "e@x.com"),
    ];
    const r = selectAudience(candidates, ["e@x.com"]);
    expect(r.candidateCount).toBe(candidates.length);
    expect(r.members.length + r.skippedTotal).toBe(candidates.length);
  });

  it("normalises the stored address — it is frozen onto the recipient row", () => {
    const r = selectAudience([sub(1, "  Bob@Example.COM  ")], []);
    expect(r.members[0].email).toBe("bob@example.com");
  });

  it("returns every skip reason as a number, never undefined", () => {
    const r = selectAudience([], []);
    expect(r.skipped).toEqual({
      invalid_email: 0,
      duplicate: 0,
      suppressed: 0,
      unsubscribed: 0,
      bounced: 0,
      complained: 0,
    });
    expect(r.members).toEqual([]);
  });
});

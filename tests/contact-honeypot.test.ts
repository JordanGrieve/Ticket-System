import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HONEYPOT_FIELDS,
  CONTACT_HONEYPOT_FIELDS,
  isHoneypotTripped,
  isContactHoneypotTripped,
} from "../lib/subscribe";

/**
 * A honeypot is only valid on a form we wrote.
 *
 * ── THE BUG THIS PINS ──
 *
 * The contact endpoint used the SIGNUP's honeypot list — "website" and
 * "company" — on a form somebody else wrote. Both are ordinary fields on a
 * real contact form; "Company" is on most B2B ones. A customer who filled
 * either was treated as a bot: discarded before validation, before the
 * database, before the mailer, and shown a cheerful success page.
 *
 * That is the bakery failure with a worse shape. The bakery at least left the
 * enquiry bouncing off an invalid key where a log could find it; this one
 * answers OK to the sender, records "honeypot" on our side, and looks from
 * every angle like a quiet week.
 *
 * It could never have caught anything it was not catching by luck: nothing we
 * hand out injects those fields on a contact form. Mode A is a plain form with
 * name, email and message; Mode B attaches to the client's own. Only the
 * NEWSLETTER form emits honeypots, and that form is ours.
 *
 * Found on 14 Sep 2026 while making the contact endpoint accept field names
 * from Shopify and WordPress — which is what made it reachable in earnest,
 * because before that a B2B form's submission failed loudly on the missing
 * `name` before the honeypot could swallow it quietly.
 */

const ROUTE = readFileSync(
  join(process.cwd(), "app/api/tickets/[id]/route.ts"),
  "utf8",
);

const INSTALL = readFileSync(
  join(process.cwd(), "components/InstallView.tsx"),
  "utf8",
);

describe("the contact form's honeypot", () => {
  it("does NOT trip on a field a human would be asked for", () => {
    // The assertion the whole file exists for.
    const realEnquiry = {
      name: "Marcus Bell",
      email: "marcus@example.com",
      message: "Do you do corporate orders?",
      company: "Bell & Sons Ltd",
      website: "https://bellandsons.example",
    };
    expect(
      isContactHoneypotTripped(realEnquiry),
      "a customer who filled in Company was silently discarded",
    ).toBe(false);
  });

  it("still trips on the namespaced fields we inject ourselves", () => {
    for (const field of CONTACT_HONEYPOT_FIELDS) {
      expect(isContactHoneypotTripped({ [field]: "http://spam.example" })).toBe(true);
    }
  });

  it("uses names no form designer would reach for", () => {
    for (const field of CONTACT_HONEYPOT_FIELDS) {
      expect(field).toMatch(/^pb_hp_/);
      // And they must not collide with anything the reader maps to a real
      // field, or a trap would eat its own submission.
      expect(HONEYPOT_FIELDS).not.toContain(field);
    }
  });

  it("is empty-safe and whitespace-safe, like the signup's", () => {
    expect(isContactHoneypotTripped({})).toBe(false);
    expect(isContactHoneypotTripped({ pb_hp_company: "   " })).toBe(false);
  });
});

describe("the newsletter signup's honeypot is untouched", () => {
  it("still trips on the fields our own signup form emits", () => {
    // That form IS ours, hidden inputs and all, so the bare names remain safe
    // there. Changing them would silently disarm every installed signup form.
    expect(HONEYPOT_FIELDS).toEqual(["website", "company"]);
    expect(isHoneypotTripped({ website: "http://spam.example" })).toBe(true);
    expect(isHoneypotTripped({ company: "Spam Co" })).toBe(true);
  });

  it("and something we hand out still emits them", () => {
    /*
     * This assertion had to change on 14 Sep 2026 and the change is the point.
     *
     * It used to check that the pasteable signup FORM was built from
     * HONEYPOT_FIELDS. That form is gone — the newsletter section is the AI
     * prompt plus a hosted link now, same as the contact form — so the emitter
     * is the prompt, which interpolates the same list under "Anti-spam fields
     * — copy these in exactly".
     *
     * Worth stating why that mattered: a honeypot with no emitter is not a
     * weaker trap, it is an inert one, and the contact endpoint spent months in
     * exactly that state while still being able to throw real enquiries away.
     * If the prompt ever stops carrying these, the signup check above becomes
     * decoration and this is where it should be noticed.
     */
    expect(INSTALL).toContain("honeypotFields");
    expect(INSTALL).toContain("Anti-spam fields");
  });
});

describe("the route uses the right one", () => {
  it("the contact endpoint checks the CONTACT list", () => {
    expect(ROUTE).toContain("isContactHoneypotTripped(fields)");
    // The bare signup check must not come back here. This is the whole defect.
    expect(ROUTE).not.toMatch(/\bisHoneypotTripped\(/);
  });
});

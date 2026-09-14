import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normaliseFieldName,
  readContactSubmission,
  readSignupSubmission,
} from "../lib/submission-fields";

/**
 * Reading a contact form we did not write.
 *
 * ── THE BUG THIS PINS ──
 *
 * Both public endpoints read `fields.name`, `fields.email` and
 * `fields.message` by their exact spellings. Almost no real form uses them,
 * including on the two platforms most small businesses are actually on — so
 * "point your form's action at this URL", the simplest mode we offer and the
 * one a non-technical client picks, posted three empty strings from a Shopify
 * or WordPress site and got back "Missing required field(s): name, email,
 * message."
 *
 * Found on 14 Sep 2026 while preparing a walkthrough on a real Shopify store
 * before a single enquiry had been sent. The bodies below are the field names
 * those platforms genuinely emit, which is the only reason this file is worth
 * anything: a test written against invented field names would have passed
 * against the broken code too.
 */

describe("normaliseFieldName", () => {
  it("takes the word out of a namespaced field", () => {
    expect(normaliseFieldName("contact[name]")).toBe("name");
    expect(normaliseFieldName("contact[email]")).toBe("email");
    expect(normaliseFieldName("form_fields[message]")).toBe("message");
  });

  it("takes the INNERMOST segment, for the platforms that nest", () => {
    expect(normaliseFieldName("data[contact][email]")).toBe("email");
  });

  it("folds punctuation and case, so one field is not three keys", () => {
    expect(normaliseFieldName("your-name")).toBe("yourname");
    expect(normaliseFieldName("your_name")).toBe("yourname");
    expect(normaliseFieldName("Your Name")).toBe("yourname");
    expect(normaliseFieldName("YOUR-NAME")).toBe("yourname");
  });

  it("does not reduce an array field to nothing", () => {
    // `tags[]` is a real Shopify spelling. An empty innermost segment must
    // fall back rather than normalising every such field to the same "" key.
    expect(normaliseFieldName("tags[]")).toBe("tags");
    expect(normaliseFieldName("contact[]")).toBe("contact");
  });
});

describe("a Shopify contact form", () => {
  // {% form 'contact' %} — the fields Shopify's own theme emits.
  const shopify = {
    form_type: "contact",
    utf8: "✓",
    "contact[name]": "Priya Raman",
    "contact[email]": "priya@example.com",
    "contact[phone]": "07700 900123",
    "contact[body]": "Do you ship to Ireland?",
  };

  it("is read correctly", () => {
    expect(readContactSubmission(shopify)).toMatchObject({
      name: "Priya Raman",
      email: "priya@example.com",
      message: "Do you ship to Ireland?",
    });
  });

  it("does not mistake Shopify's machinery for a person's words", () => {
    const r = readContactSubmission(shopify);
    expect(r.subject).not.toBe("contact");
    expect(r.name).not.toBe("✓");
    expect(r.message).not.toBe("contact");
  });
});

describe("a WordPress Contact Form 7 form", () => {
  it("is read correctly", () => {
    expect(
      readContactSubmission({
        "your-name": "Marcus Bell",
        "your-email": "marcus@example.com",
        "your-subject": "Order ORD-4821",
        "your-message": "It arrived damaged.",
        _wpnonce: "a1b2c3",
        _wp_http_referer: "/contact/",
      }),
    ).toEqual({
      name: "Marcus Bell",
      email: "marcus@example.com",
      subject: "Order ORD-4821",
      message: "It arrived damaged.",
    });
  });
});

describe("an Elementor form", () => {
  it("is read correctly", () => {
    expect(
      readContactSubmission({
        "form_fields[name]": "Ana Silva",
        "form_fields[email]": "ana@example.com",
        "form_fields[message]": "Can I book for twelve people?",
      }),
    ).toMatchObject({ name: "Ana Silva", message: "Can I book for twelve people?" });
  });
});

describe("a form somebody wrote by hand", () => {
  it("still reads the documented names, unchanged", () => {
    // The whole existing world. If this ever regresses, every installation in
    // production breaks at once.
    expect(
      readContactSubmission({
        name: "Sam Okafor",
        email: "sam@example.com",
        message: "Hello",
        subject: "Hi",
      }),
    ).toEqual({
      name: "Sam Okafor",
      email: "sam@example.com",
      message: "Hello",
      subject: "Hi",
    });
  });

  it("prefers the documented name when a form carries both spellings", () => {
    // Order is the contract: the exact name we ask for always wins, so an
    // integration that did it properly cannot be overridden by a stray field.
    expect(
      readContactSubmission({
        name: "Correct",
        "contact[name]": "Wrong",
        email: "a@b.co",
        message: "m",
      }).name,
    ).toBe("Correct");
  });

  it("joins a split first and last name", () => {
    expect(
      readContactSubmission({
        firstname: "Emma",
        lastname: "Fitzgerald",
        email: "emma@example.com",
        message: "Hello",
      }).name,
    ).toBe("Emma Fitzgerald");
  });

  it("takes either half when only one is given", () => {
    expect(
      readContactSubmission({ fname: "Emma", email: "e@x.co", message: "m" }).name,
    ).toBe("Emma");
  });

  it("reads the common wordings for a message box", () => {
    for (const key of ["comments", "enquiry", "question", "details", "body"]) {
      expect(
        readContactSubmission({ name: "A", email: "a@b.co", [key]: "the words" })
          .message,
        `a form calling its message box "${key}" was read as empty`,
      ).toBe("the words");
    }
  });
});

describe("what it refuses to do", () => {
  it("returns empty rather than guessing at numbered fields", () => {
    /*
     * WPForms posts wpforms[fields][0] and Gravity Forms posts input_1. The
     * digits carry no meaning, and a guess would file a phone number as a name
     * on somebody's real enquiry. An honest 400 sends them to the JavaScript
     * snippet or the AI prompt, which can see the form and map it properly.
     */
    const r = readContactSubmission({
      "wpforms[fields][0]": "Priya Raman",
      "wpforms[fields][1]": "priya@example.com",
      "wpforms[fields][2]": "Do you ship to Ireland?",
      "wpforms[id]": "42",
    });
    expect(r.name).toBe("");
    expect(r.email).toBe("");
    expect(r.message).toBe("");
  });

  it("skips a field that is present but empty, and keeps looking", () => {
    expect(
      readContactSubmission({
        email: "   ",
        "contact[email]": "real@example.com",
        name: "A",
        message: "m",
      }).email,
    ).toBe("real@example.com");
  });

  it("never treats a password or a CSRF token as content", () => {
    // The snippet now posts EVERY field the form has, so these arrive.
    const r = readContactSubmission({
      password: "hunter2",
      csrf_token: "abc",
      authenticity_token: "def",
      "g-recaptcha-response": "ghi",
      name: "A",
      email: "a@b.co",
      message: "m",
    });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(JSON.stringify(r)).not.toContain("abc");
    expect(JSON.stringify(r)).not.toContain("ghi");
  });
});

describe("the endpoints actually use it", () => {
  /*
   * The gap a break-test found, and the reason this block exists.
   *
   * Every assertion above proves the pure function is right. Not one of them
   * noticed when the ROUTE was reverted to `fields.name ?? ""` — which is the
   * defect itself, restored, with the whole suite green. A correct function
   * nobody calls is the bug.
   */
  /**
   * Source with its comments removed.
   *
   * The first version asserted against the raw file and failed on the comment
   * that EXPLAINS the fix — which names `fields.name` in prose. A guard that
   * trips on its own documentation trains people to weaken it.
   */
  function code(path: string): string {
    const raw = readFileSync(join(process.cwd(), path), "utf8");
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    // The stripper must not eat the file; a mangled empty string would make
    // every `not.toContain` below pass for the wrong reason.
    expect(stripped).toContain("export async function POST");
    return stripped;
  }

  const ticketsRoute = code("app/api/tickets/[id]/route.ts");
  const subscribeRoute = code("app/api/subscribe/[key]/route.ts");

  it("the contact endpoint reads by meaning", () => {
    expect(ticketsRoute).toContain("readContactSubmission(fields)");
  });

  it("the contact endpoint no longer reaches for the exact spellings", () => {
    // `fields.name`, `fields.email`, `fields.message`, `fields.subject` —
    // the four reads that only ever worked on a form written to our docs.
    for (const field of ["name", "email", "message", "subject"]) {
      expect(
        ticketsRoute,
        `the route reads fields.${field} directly again`,
      ).not.toContain(`fields.${field}`);
      expect(ticketsRoute).not.toContain(`fields["${field}"]`);
    }
  });

  it("the signup endpoint reads by meaning too", () => {
    expect(subscribeRoute).toContain("readSignupSubmission(fields)");
    expect(subscribeRoute).not.toContain("parseSignupInput(fields)");
  });
});

describe("the newsletter signup reads the same way", () => {
  it("accepts a Shopify signup", () => {
    // What byamoria.com's own "opening soon" form posts today.
    expect(
      readSignupSubmission({
        form_type: "customer",
        utf8: "✓",
        "contact[email]": "priya@example.com",
      }),
    ).toEqual({ email: "priya@example.com", name: "" });
  });

  it("still accepts our own pasted form", () => {
    expect(
      readSignupSubmission({ email: "a@b.co", name: "Ana" }),
    ).toEqual({ email: "a@b.co", name: "Ana" });
  });
});

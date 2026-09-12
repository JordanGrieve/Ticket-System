import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The JavaScript snippet a client pastes onto their own website to wire up the
 * contact form they already have.
 *
 * Static assertions over the source, the same instrument and the same reason as
 * tests/install-newsletter-prompt.test.ts: this is a string constant inside a
 * client component, and rendering it needs React, Clerk and a workspace. What is
 * at risk is not layout — it is that this code RUNS ON SOMEBODY ELSE'S LIVE
 * SITE, pasted by a person who will not read it first. A bad line here is a bad
 * line on a real business's contact page, and nobody in the chain is positioned
 * to notice.
 *
 * ── WHAT THIS WAS WRITTEN FOR ──
 *
 * The snippet reported both success and failure with `alert()`. Three things
 * wrong with that, in increasing order of seriousness:
 *
 *  1. It is a browser-chrome modal dropped into the middle of a designed page —
 *     the one visual thing the whole install story promises not to do. The help
 *     text beside it has always said visitors "stay on the page and see a
 *     success message", and a modal dialog is not that.
 *  2. The submit button stayed live while the request was in flight, so an
 *     impatient visitor could open the same enquiry three times.
 *  3. Our OWN AI prompt, four hundred lines down the same file, instructs an
 *     assistant to "show a clear inline success message" and "disable the submit
 *     button while sending". The snippet a human copies was giving worse advice
 *     than the prompt a machine copies, from the same screen.
 */

const SRC = readFileSync(
  join(process.cwd(), "components/InstallView.tsx"),
  "utf8",
);

/** Just the pasteable JS snippet, so assertions cannot match elsewhere. */
function snippetSource(): string {
  const start = SRC.indexOf("const snippetB = ");
  expect(start, "snippetB is gone or renamed").toBeGreaterThan(-1);
  const end = SRC.indexOf("const snippetAI = ", start);
  expect(end, "snippetAI no longer follows snippetB").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("the contact-form snippet a client pastes on their site", () => {
  const snippet = snippetSource();

  it("never opens a browser dialog", () => {
    // The whole point. `alert`, `confirm` and `prompt` are all modal, all
    // unstyleable, and all wrong on a page somebody designed.
    expect(snippet).not.toMatch(/\balert\s*\(/);
    expect(snippet).not.toMatch(/\bconfirm\s*\(/);
    expect(snippet).not.toMatch(/\bprompt\s*\(/);
  });

  it("writes its reply into the page instead", () => {
    expect(snippet).toContain("data-postbox-status");
    expect(snippet).toContain("textContent");
  });

  it("announces that reply to a screen reader", () => {
    // The message appears without moving focus, so without a live region a
    // non-sighted visitor gets silence and no idea whether it sent.
    expect(snippet).toContain('setAttribute("role", "status")');
  });

  it("disables the submit button while sending, and puts it back", () => {
    expect(snippet).toContain("button.disabled = true");
    expect(snippet).toContain("button.disabled = false");
    // In a `finally`, so a thrown request does not leave the form dead.
    const restoreAt = snippet.indexOf("button.disabled = false");
    const finallyAt = snippet.indexOf("} finally {");
    expect(finallyAt, "no finally block").toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(finallyAt);
  });

  it("still clears the form only on success", () => {
    // A reset on failure throws away what the visitor typed, which is the most
    // expensive bug this file could ship.
    const okAt = snippet.indexOf("if (res.ok) {");
    const resetAt = snippet.indexOf("form.reset()");
    const elseAt = snippet.indexOf("} else if", okAt);
    expect(okAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(okAt);
    expect(resetAt).toBeLessThan(elseAt);
  });

  it("tells a rate-limited visitor to wait rather than to retry now", () => {
    // The endpoint allows 60 a minute per workspace. "Try again" against a 429
    // invites exactly the behaviour that caused it.
    expect(snippet).toContain("res.status === 429");
    expect(snippet).toMatch(/in a minute/i);
  });

  it("offers a way through when sending fails", () => {
    // A dead end on a contact form is a lost customer. The fallback has to be
    // something they can act on without us.
    expect(snippet).toMatch(/email us directly/i);
  });

  it("imposes no styling of its own", () => {
    // The snippet's entire claim is that it does not touch the site's design.
    // A colour or a layout rule in here would quietly make that false.
    expect(snippet).not.toMatch(/style\.(color|background|border|font|padding|margin)/);
    expect(snippet).not.toMatch(/cssText/);
  });
});

describe("the snippet and the AI prompt give the same advice", () => {
  it("both ask for an inline message and a disabled button", () => {
    // These two sit on the same screen behind two toggles. They drifted once,
    // with the machine-readable one correct and the human-readable one not.
    const prompt = SRC.slice(SRC.indexOf("const snippetAI = "));
    expect(prompt).toMatch(/inline success message/i);
    expect(prompt).toMatch(/disable the submit button/i);

    const snippet = snippetSource();
    expect(snippet).toContain("button.disabled = true");
    expect(snippet).toContain("data-postbox-status");
  });
});

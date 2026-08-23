import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HONEYPOT_FIELDS } from "../lib/subscribe";

/**
 * The "AI prompt" the client hands to their own coding assistant to wire up a
 * newsletter signup form they already have on their site.
 *
 * Static assertions over the source, in the style of
 * tests/access-log-page.test.ts and for the same reason: this lives in a client
 * component, and rendering it needs React, Clerk and a workspace. A blunt test
 * that runs in CI beats a precise one that never does.
 *
 * What is actually at risk here is not layout. It is that this text is executed
 * — by a language model, on somebody else's website, unsupervised. A wrong
 * sentence in it becomes wrong code on a real business's live page, and nobody
 * involved is in a position to notice. The assertions below pin the parts where
 * being wrong is expensive rather than untidy.
 */

const SRC = readFileSync(
  join(process.cwd(), "components/InstallView.tsx"),
  "utf8",
);

/** Just the prompt builder, so assertions cannot accidentally match elsewhere. */
function promptBuilderSource(): string {
  const start = SRC.indexOf("function buildNewsletterAiPrompt");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, end === -1 ? undefined : end);
}

describe("newsletter AI prompt", () => {
  it("interpolates the honeypot names instead of hardcoding them", () => {
    const body = promptBuilderSource();

    // The names must arrive via the `fields` parameter, which the page fills
    // from HONEYPOT_FIELDS. Hardcoding them here would mean a prompt already
    // pasted into somebody's chat kept naming a trap we had since renamed —
    // and a renamed trap that a form still fills in is a form that silently
    // discards every real signup.
    expect(body).toContain("fields");
    for (const name of HONEYPOT_FIELDS) {
      expect(body).not.toContain(`name="${name}"`);
    }
  });

  it("forbids the assistant from claiming the signup is complete", () => {
    const body = promptBuilderSource();

    // The single most likely thing for a model to get wrong. A signup form
    // normally says "You're subscribed!", and here that is false: nothing is
    // stored until the confirmation link is pressed. A visitor told they are
    // on the list does not go and press it, and the business never learns why
    // the list stopped growing.
    expect(body).toContain("DO NOT say");
    expect(body).toMatch(/You'?re subscribed/i);
    expect(body).toMatch(/check your email/i);
  });

  it("tells the assistant to keep the site's existing design", () => {
    const body = promptBuilderSource();
    // The whole reason this mode exists: the client already has a styled
    // signup section. Replacing it with a plain form is a regression the
    // client sees immediately and blames us for.
    expect(body).toMatch(/do not redesign|do not restyle/i);
  });

  it("says no DNS changes are needed, and says why that is separate", () => {
    const body = promptBuilderSource();
    // Asked directly by the first client. An assistant left to guess will
    // invent DNS steps, and a business owner who thinks they need to edit
    // domain records to collect an email address simply does not do it.
    expect(body).toMatch(/No DNS changes/i);
  });

  it("does not tell the assistant to distinguish signup outcomes", () => {
    const body = promptBuilderSource();
    // The endpoint answers identically whether the address is new, already
    // subscribed, or suppressed — that is what stops the form being used to
    // test who is on a list. Code written to branch on the difference would
    // be code written against a distinction that does not exist.
    expect(body).toMatch(/answers identically|nothing to distinguish/i);
  });

  it("does not invite any secret onto the client's page", () => {
    // Collapse the hard wrapping first. This is prose written to ~80 columns,
    // so any phrase long enough to be worth asserting on will sometimes
    // straddle a line break; matching against the flattened text means a
    // reflowed paragraph does not fail the build for no reason.
    const flat = promptBuilderSource().replace(/\s+/g, " ");

    expect(flat).toMatch(/public ingestion key/i);
    expect(flat).toMatch(/Do not add any other secret/i);

    for (const name of [
      "SUBSCRIBE_TOKEN_SECRET",
      "CRON_SECRET",
      "INBOUND_WEBHOOK_SECRET",
      "DATABASE_URL",
      "CLERK_SECRET_KEY",
      "AWS_SECRET_ACCESS_KEY",
    ]) {
      expect(flat).not.toContain(name);
    }
  });

  it("is offered as its own mode, with the plain form and the link", () => {
    // All three routes to a signup have to stay reachable: paste a form, hand
    // the prompt to an assistant, or copy a link and write no code at all.
    expect(SRC).toContain('nlMode === "form"');
    expect(SRC).toContain('nlMode === "ai"');
    expect(SRC).toContain('nlMode === "link"');
    expect(SRC).toContain("newsletterAiPrompt");
  });
});

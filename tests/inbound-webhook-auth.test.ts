import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * How the inbound webhook authenticates a caller, pinned at the source.
 *
 * The ?secret= query form was retired on 13 Oct 2026. A query string is
 * written to access logs, proxy logs and Referer headers, so a credential
 * that can post a fabricated email into any workspace was being logged in
 * plain text on every delivery. The header form stays for manual testing,
 * compared in constant time like every other secret; Resend deliveries are
 * authorised by their Svix signature.
 */
describe("inbound webhook authentication", () => {
  const route = readFileSync("app/api/inbound/route.ts", "utf8");
  const auth = route.slice(
    route.indexOf("export async function POST"),
    route.indexOf("Invalid signature"),
  );

  it("never reads the shared secret from the query string", () => {
    expect(auth).not.toContain("searchParams");
    expect(auth).not.toContain('"secret"');
  });

  it("reads it from the header, compared in constant time", () => {
    expect(auth).toContain('req.headers.get("x-webhook-secret")');
    expect(auth).toContain("tokensEqual(provided, sharedSecret)");
    expect(auth).not.toContain("provided === sharedSecret");
  });

  it("still verifies the Svix signature on the raw body", () => {
    expect(auth).toContain("verifySvixSignature(raw, req.headers, signingSecret)");
  });

  it("still fails closed when nothing is configured", () => {
    expect(auth).toContain("if (!signingSecret && !sharedEnabled)");
    expect(auth).toContain("status: 503");
  });
});

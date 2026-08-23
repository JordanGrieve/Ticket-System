import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Svix webhook signature — the scheme Resend signs its webhooks with.
 *
 * Extracted from app/api/inbound/route.ts on 23 August 2026 when a second
 * Resend webhook (delivery events) needed the same check. Two copies of a
 * signature verifier is how one of them quietly gets a weaker version: the
 * replay window drifts, or a `===` replaces the timing-safe compare, and the
 * copy nobody is looking at is the one that stops protecting anything.
 *
 * signedContent = "{svix-id}.{svix-timestamp}.{rawBody}", HMAC-SHA256 keyed
 * with the base64 part of the whsec_ signing secret, compared timing-safely
 * against each space-separated "v1,<base64>" entry in svix-signature.
 *
 * ── THE RAW BODY, NOT A REPARSED ONE ──
 * Callers must pass the exact bytes received. Anything that round-trips the
 * payload through JSON.parse and back invalidates a perfectly good signature
 * and produces a mystery 400 that looks like a provider fault.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject stale or future timestamps (replay protection, ±5 minutes). A valid
  // signature is valid forever without this, so a captured request could be
  // replayed indefinitely.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  let key: Buffer;
  try {
    key = Buffer.from(
      signingSecret.startsWith("whsec_") ? signingSecret.slice(6) : signingSecret,
      "base64",
    );
  } catch {
    return false;
  }

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig);
    // Length check first: timingSafeEqual throws on a mismatch rather than
    // returning false, and an exception here would be a 500 on a forged
    // signature instead of a refusal.
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

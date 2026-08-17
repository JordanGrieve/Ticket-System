/**
 * Secrets embedded in public URLs and addresses — one module, one generator.
 *
 * These used to be split across db/tokens.ts (unsubscribe, form key) and
 * lib/data.ts (reply token), which is how one of them quietly ends up weaker
 * than the others: nothing sits next to the pair to show the entropy differs.
 * Everything here goes through the same randomHex.
 *
 * Never derive any of these from an id, an email, or a timestamp — the whole
 * point is that holding one URL tells you nothing about anybody else's.
 *
 * NOTE: generateApiKey() still lives in lib/workspace.ts, next to the
 * provisioning that mints it. It is the same construction; it belongs here.
 */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-recipient unsubscribe secret (32 hex chars). */
export function generateUnsubscribeToken(): string {
  return randomHex(16);
}

/** Public contact-form key, e.g. "frm_1a2b…" (32 hex chars). */
export function generateFormKey(): string {
  return `frm_${randomHex(16)}`;
}

/**
 * Per-ticket reply-address secret (32 hex chars).
 *
 * This was 8 hex chars — 32 bits — on the reasoning that it is paired with a
 * ticket id an attacker would also have to guess. That reasoning does not hold:
 * ticket ids are sequential, so they are not a secret, and this token is the
 * ONLY thing stopping someone mailing into another tenant's ticket. It guards a
 * public endpoint that accepts unauthenticated mail, with unlimited attempts
 * and no lockout, so 32 bits is thin for the job it is actually doing.
 *
 * Length is not a real constraint here. Nobody types a reply address by hand —
 * it is generated into a Reply-To header and the mail client round-trips it.
 *
 * EXISTING TICKETS KEEP THEIR SHORT TOKENS. Regenerating them would invalidate
 * reply-to addresses already sitting in customers' inboxes and silently break
 * threading on live conversations. The width only grows going forward.
 */
export function generateReplyToken(): string {
  return randomHex(16);
}

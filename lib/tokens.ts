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
 * Per-ticket reply-address secret (8 hex chars). Shorter than the others
 * because it is only ever paired with a ticket id an attacker would also have
 * to guess, and it has to survive being typed into a mail client's To: field.
 */
export function generateReplyToken(): string {
  return randomHex(4);
}

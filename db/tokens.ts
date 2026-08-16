/**
 * Secrets embedded in public URLs. Same construction as the existing
 * generateReplyToken / generateApiKey helpers: crypto.getRandomValues, hex.
 * Never derive these from an id, an email, or a timestamp — the whole point is
 * that holding one URL tells you nothing about anybody else's.
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

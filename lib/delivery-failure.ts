/**
 * Why a campaign send failed, and whether it is worth trying again.
 *
 * ── WHY IT HAS ITS OWN FILE ──
 * These two lived in lib/deliver-ses.ts, where they were written, and the
 * Resend deliverer imported them from there — so deleting the SES adapter on
 * 14 Sep 2026 took the retry rule of the ONLY live provider with it. Nothing
 * about either is Amazon's: a failure is throttled, transient, paused,
 * suppressed or permanent whoever refused it, and the question "may a sweep
 * retry this?" has the same answer either way.
 *
 * Pure, and importing nothing. It is shared vocabulary between a deliverer and
 * the sweep that retries after it, and vocabulary that lives inside one
 * implementation is vocabulary the next implementation quietly redefines.
 */

export type DeliveryFailureKind =
  | "throttled"
  | "transient"
  | "paused"
  | "suppressed"
  | "permanent";

/**
 * The ONLY kinds a retry sweep may act on.
 *
 * Written as an allowlist, not a denylist of the bad ones. A failure kind added
 * later defaults to "do not retry", which is the direction that fails safe: the
 * cost of not retrying a retryable message is one lost email, and the cost of
 * retrying a hard bounce is deliverability damage for every tenant.
 */
export function isRetryableFailure(kind: DeliveryFailureKind): boolean {
  return kind === "throttled" || kind === "transient";
}

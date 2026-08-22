/** Shared CORS headers for the public ingestion endpoint. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** JSON response with optional extra headers (e.g. CORS). */
export function json(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Light email sanity check — good enough to reject obvious junk. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * The client's IP as the edge reported it, or null when it did not.
 *
 * Returns the FIRST entry of X-Forwarded-For. The header is appended to hop by
 * hop, so the leftmost value is the original client and everything after it is
 * infrastructure.
 *
 * Null is a real answer and callers must keep it as one. This is stored as
 * consent evidence, and "we do not know" recorded honestly is worth more than
 * a placeholder that reads like a fact.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    // 45 characters is the longest valid IPv6 text form. This is a bound on
    // attacker-supplied header content, not a format check — see the note on
    // consentIp in db/schema.ts for why the value is stored verbatim.
    if (first) return first.slice(0, 45);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 45) : null;
}

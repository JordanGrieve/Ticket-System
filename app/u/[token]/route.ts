import { looksLikeUnsubscribeToken } from "@/lib/newsletter";
import { unsubscribeByToken } from "@/lib/suppressions";

/**
 * /u/[token] — the public unsubscribe endpoint.
 *
 * This is the URL `unsubscribeUrl()` builds and `listUnsubscribeHeaders()`
 * advertises. Two callers, with different needs:
 *
 *   POST — Gmail, Yahoo and friends, unattended (RFC 8058 one-click). No
 *          session, no cookies, no CSRF token, no confirmation click. The body
 *          is `List-Unsubscribe=One-Click` and we do not read it: the token in
 *          the path is the whole of the authorisation. It must act
 *          IMMEDIATELY — a page that asks for confirmation is a non-compliant
 *          unsubscribe, and a provider's fallback for "unsubscribe didn't
 *          work" is the spam button.
 *   GET  — a human who clicked the footer link. Sent to the confirmation page,
 *          which posts back here. GET does NOT unsubscribe: corporate mail
 *          scanners and link-preview bots fetch every URL in a message, and a
 *          GET that mutates would opt people out who never clicked anything.
 *          RFC 8058 is satisfied by the POST, so nothing is lost.
 *
 * ── NO ENUMERATION ──
 * Every response is identical whether the token exists, is expired-looking, is
 * malformed, or belongs to another tenant. No 404, no different status, no
 * different body, and nothing about the recipient (their address, the sender,
 * the campaign) is ever rendered. The token is 128 bits from
 * generateUnsubscribeToken(); the only thing this endpoint must not do is
 * confirm a guess.
 *
 * ── IDEMPOTENT ──
 * Unsubscribing twice succeeds. See unsubscribeByToken().
 *
 * ── PUBLIC BY WAY OF proxy.ts ──
 * `clerkMiddleware` protects every route not listed in `isPublicRoute`, so
 * this path only works because `"/u/(.*)"` is listed there. Removing that entry
 * does not break a page visibly — it 307s the provider's one-click POST to
 * /sign-in, and the unsubscribe silently stops happening. Do not remove it.
 *
 * ── NOT A PAGE ──
 * A Next.js segment cannot hold both `route.ts` and `page.tsx`, and the
 * machine POST has to land on this exact path, so the human-facing pages live
 * one level down (`confirm/`, `done/`) and GET redirects into them.
 */

const NO_STORE = {
  // Nothing here may be cached: a cached "unsubscribed" page shown to the next
  // reader of a shared inbox, or a cached redirect, is a lie about a legal
  // obligation.
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

type Ctx = { params: Promise<{ token: string }> };

/**
 * Human entry point. Redirects to the confirmation page — 303 so the browser
 * follows with a GET regardless of how it arrived.
 *
 * No database access at all, which is also what makes it impossible to time
 * this request into a token oracle.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE,
      Location: `/u/${encodeURIComponent(token)}/confirm`,
    },
  });
}

/**
 * One-click unsubscribe. Unauthenticated by design.
 *
 * Two shapes of caller, distinguished ONLY by a query flag our own
 * confirmation page sets — never by sniffing the user agent or the Accept
 * header, which providers vary without notice:
 *
 *   • `?web=1` → a human pressed the button. Redirect (303) to the "done" page
 *     so a refresh does not re-post.
 *   • anything else → a mail provider. 200 with a one-line text body. The body
 *     is ignored by every provider; the status code is the contract.
 *
 * A failure to write is a 500, deliberately: providers retry 5xx, and silently
 * answering 200 to an unsubscribe we did not record is the one outcome that is
 * both a legal breach and invisible.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const fromWeb = new URL(req.url).searchParams.get("web") === "1";

  // Junk never reaches the database. An unknown-but-well-formed token still
  // does, so that a real token and a fake one take the same path.
  if (looksLikeUnsubscribeToken(token)) {
    try {
      const outcome = await unsubscribeByToken(
        token,
        fromWeb ? "link" : "one_click",
      );
      // Logged, never returned. `matched: false` is a stranger poking at the
      // endpoint; the response below is the same either way.
      if (!outcome.matched) {
        console.warn("[unsubscribe] token did not match any recipient row");
      }
    } catch (err) {
      console.error("[unsubscribe] failed to record unsubscribe", err);
      return new Response("Unsubscribe failed, please try again.", {
        status: 500,
        headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  if (fromWeb) {
    return new Response(null, {
      status: 303,
      headers: {
        ...NO_STORE,
        Location: `/u/${encodeURIComponent(token)}/done`,
      },
    });
  }

  return new Response("Unsubscribed.\n", {
    status: 200,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

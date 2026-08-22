import { clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { APP_URL } from "@/lib/config";
import { decodeConfirmToken } from "@/lib/subscribe";
import {
  confirmSubscription,
  resolveSigningSecret,
} from "@/lib/subscribe-store";

/**
 * POST /api/subscribe-confirm — the only write in the signup feature.
 *
 * ── WHY POST, AND WHY NOT A GET ON /s/confirm ──
 * The link in the confirmation email is a GET to a PAGE that renders a button;
 * this is where the button posts. Corporate mail scanners and link-preview
 * bots fetch every URL in a message, so a GET that subscribed would mean the
 * scanner consented on the recipient's behalf — destroying the only thing
 * double opt-in exists to produce. app/u/[token]/route.ts refuses GET for the
 * mirror-image reason.
 *
 * ── WHY NOT app/api/subscribe/confirm ──
 * That path sits under the [key] dynamic segment. Static segments do win in
 * App Router, so it would route correctly, but it would also mean a workspace
 * whose key were ever the literal string "confirm" silently lost its signup
 * endpoint. A sibling path costs nothing and has no such edge.
 */
export async function POST(req: Request) {
  const fields = await readFields(req);
  const token = (fields.t ?? "").trim();

  // Tokens are unguessable, but the decode does HMAC work per attempt and this
  // route is public. Cheap ceiling per address.
  const ip = clientIp(req);
  if (ip) {
    const limit = rateLimit(`confirm:ip:${ip}`, { max: 20, windowMs: 60_000 });
    if (!limit.ok) return redirect("/s/confirm?e=1");
  }

  const secret = resolveSigningSecret();
  if (!secret) {
    console.error("[subscribe] confirm attempted with no signing secret set");
    return redirect("/s/confirm?e=1");
  }

  const decoded = decodeConfirmToken(token, secret);
  if (!decoded.ok) {
    // The reason is for us; the clicker gets one page for all three. Telling a
    // prober whether their token was expired or forged tells them which half
    // of the guess was right.
    console.warn("[subscribe] confirmation rejected:", decoded.reason);
    return redirect("/s/confirm?e=1");
  }

  const { workspaceId, email, name, consentSource } = decoded.payload;

  const outcome = await confirmSubscription({
    workspaceId,
    email,
    name,
    consentSource,
    // The IP of THIS request — the click — because this statement records
    // consent at the moment of confirmation. See confirmSubscription().
    consentIp: ip,
  });

  // Logged, never rendered. A suppressed address gets the same page as a
  // successful one: somebody who reported this sender for spam and then
  // clicked a signup link must not be able to learn that they are blocked,
  // and an attacker replaying a link must not learn it either.
  console.info(
    "[subscribe] confirmed workspace=%d subscribed=%s suppressed=%s existed=%s consentRecorded=%s",
    workspaceId,
    outcome.subscribed,
    outcome.suppressed,
    outcome.existed,
    outcome.consentRecorded,
  );

  return redirect("/s/done");
}

// ── helpers ──────────────────────────────────────────────────────

function redirect(path: string): Response {
  return new Response(null, {
    // 303 so the browser follows with GET and a reload cannot re-post.
    status: 303,
    headers: { Location: `${APP_URL.replace(/\/$/, "")}${path}` },
  });
}

async function readFields(req: Request): Promise<Record<string, string>> {
  try {
    const form = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    // Unparseable body: fall through to an empty token, which fails the decode
    // and renders the same page as any other bad token. Never a 500.
    return {};
  }
}

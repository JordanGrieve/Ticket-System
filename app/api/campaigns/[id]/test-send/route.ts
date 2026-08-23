import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { APP_URL } from "@/lib/config";
import { resolveViewer } from "@/lib/viewer";
import { getCampaign } from "@/lib/campaign-send";
import { generateUnsubscribeToken } from "@/lib/tokens";
import {
  createCampaignDeliverer,
  deliveryModeFromEnv,
  SES_DELIVERY_MODE,
} from "@/lib/deliver";
import { envelopeFromEnv } from "@/lib/campaign-cron";
import {
  listUnsubscribeHeaders,
  mailableSender,
  renderCampaign,
  unsubscribeUrl,
} from "@/lib/newsletter";

/**
 * POST /api/campaigns/:id/test-send — send this campaign to YOURSELF, once.
 *
 * ── WHY THIS EXISTS ──
 * Until it did, the only way to make a real message leave the building was to
 * arm a real campaign at a real audience. Open Door Bakery's audience is one
 * confirmed subscriber, and the campaign machinery is one-way: a rejected
 * address is written `failed`, `settleCampaign` counts failed rows as drained
 * and marks the campaign `sent`, and there is no re-queue path anywhere in the
 * product. So "just try a send" costs the only real subscriber this product
 * has, permanently, and the UI reports it as success.
 *
 * It is also the honest way to satisfy the SES production-access precondition
 * "have you tested" — docs/SES-PRODUCTION-ACCESS.md §1 asks for exactly this
 * and, before this route, satisfying it as written meant burning that row.
 *
 * ── IT TOUCHES NO CAMPAIGN STATE ──
 * No campaign_recipients row, no status transition, no unsubscribe token that
 * belongs to anybody. It reads the campaign and sends one message. Running it
 * a hundred times leaves the database exactly as it found it, which is the
 * property that makes it safe to reach for.
 *
 * ── YOU CAN ONLY SEND IT TO YOURSELF ──
 * The recipient is the authenticated viewer's own address, taken from the
 * session. It is NOT read from the request body, and there is no parameter to
 * override it. That is deliberate: a "send a test to this address" endpoint
 * behind a login is a spam relay with an audit trail, and in the SES sandbox
 * it would also fail for every address except a verified one. Restricting it
 * to the caller removes the abuse case rather than policing it.
 */

// Node, not edge: the deliverer uses node:crypto for SigV4.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = idFrom((await ctx.params).id);
  if (campaignId === null) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const viewer = await resolveViewer();
  if (!viewer.workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const workspace = viewer.workspace;

  const to = (viewer.email ?? "").trim();
  if (!to) {
    // Nothing to fall back to, and nothing worth guessing at. An account with
    // no address on it cannot be the recipient of its own test.
    return json(
      { error: "Your account has no email address on it." },
      { status: 400 },
    );
  }

  // Per-viewer, not per-IP. The address is fixed to the caller, so this is not
  // holding back abuse — it is stopping a stuck button from sending forty
  // copies of the same draft to somebody's own inbox, and from spending the
  // account's daily SES quota (200/day in the sandbox) on tests.
  const limit = rateLimit(`test-send:${userId}`, { max: 6, windowMs: 600_000 });
  if (!limit.ok) {
    return json(
      {
        error: `Too many test sends. Try again in ${Math.ceil(
          limit.retryAfterSeconds / 60,
        )} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const campaign = await getCampaign(workspace.id, campaignId);
  if (!campaign) return json({ error: "Not found" }, { status: 404 });

  // The same gate as the real send, on purpose. A test that skipped it would
  // render a footer the real message cannot legally carry, which makes the
  // test worth less than not running it.
  const sender = mailableSender({
    workspaceName: workspace.name,
    legalName: workspace.legalName,
    postalAddress: workspace.postalAddress,
  });
  if (!sender) {
    return json(
      {
        error:
          "Add your postal address in Settings first — a test should look exactly like the real message, and the real message cannot go out without one.",
      },
      { status: 409 },
    );
  }

  const envelope = envelopeFromEnv(process.env);
  if (!envelope.ok) {
    console.error(`[test-send] ${envelope.error}`);
    return json(
      { error: "Campaign sending is not configured yet." },
      { status: 503 },
    );
  }

  let deliver;
  try {
    deliver = createCampaignDeliverer();
  } catch (err) {
    console.error("[test-send] deliverer refused to construct:", err);
    return json({ error: "Delivery is misconfigured." }, { status: 503 });
  }

  // A real-shaped token belonging to no recipient row. Shaped correctly so the
  // footer and the List-Unsubscribe headers are byte-identical in structure to
  // a real send — that is half of what this test is for. Pressing it resolves
  // to nothing, which app/u/[token] already handles without revealing whether
  // a token was ever valid.
  const url = unsubscribeUrl(APP_URL, generateUnsubscribeToken());

  const rendered = renderCampaign({
    campaign: {
      subject: campaign.subject,
      preheader: campaign.preheader,
      templateKey: campaign.templateKey,
      body: campaign.body,
    },
    recipient: { email: to, name: null },
    workspaceName: workspace.name,
    unsubscribeUrl: url,
    sender,
  });

  const mode = deliveryModeFromEnv(process.env);

  try {
    const res = await deliver({
      to,
      from: envelope.envelope.from,
      // Prefixed so a test can never be mistaken for the real campaign sitting
      // in the same inbox. The BODY is left exactly as it will be sent — the
      // point is to inspect the real thing.
      subject: `[TEST] ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
      headers: listUnsubscribeHeaders({
        url,
        mailto: envelope.envelope.unsubscribeMailto,
      }),
    });

    return json({
      ok: true,
      to,
      mode,
      messageId: res.id ?? null,
      // Stated rather than implied. In log mode nothing was transmitted, and a
      // green tick that means "written to a log file" is the exact dishonesty
      // this whole screen was built to avoid.
      transmitted: mode === SES_DELIVERY_MODE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test-send] delivery failed:", message);
    // The provider's own words. This endpoint exists to surface exactly this —
    // "MessageRejected: Email address is not verified" is the sandbox telling
    // you something true, and paraphrasing it would waste the trip.
    return json({ error: `Delivery failed: ${message}` }, { status: 502 });
  }
}

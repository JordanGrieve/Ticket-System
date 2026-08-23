import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { resolveViewer } from "@/lib/viewer";
import { stripeClient, stripePriceId } from "@/lib/stripe";
import { PLANS, type PlanId } from "@/lib/pricing";
import { APP_URL } from "@/lib/config";

/**
 * Start a Stripe Checkout session for the signed-in workspace.
 *
 * ── THE PLAN COMES FROM THE REQUEST, THE WORKSPACE NEVER DOES ──
 * The caller chooses which plan to buy, and that is all they choose. The
 * workspace is re-resolved from the session every time. A workspace id in the
 * body would let anybody buy a subscription "for" someone else's workspace —
 * or, far worse in combination with the webhook, attach their own cheap
 * subscription to another tenant and take it over.
 *
 * The plan id is validated against PLANS rather than passed through: an
 * unrecognised id must fail here rather than reach Stripe and produce a
 * session for a price that does not exist.
 *
 * ── NO PRICE IS TAKEN FROM THE CLIENT ──
 * Only the plan id crosses the wire. The amount comes from the Stripe Price
 * object named by our own environment. Accepting an amount from a browser is
 * the oldest checkout bug there is.
 */
export async function POST(req: Request): Promise<Response> {
  const viewer = await resolveViewer();
  if (!viewer.workspace) {
    return Response.json({ error: "No workspace" }, { status: 403 });
  }

  const stripe = stripeClient();
  if (!stripe) {
    // Deliberately explicit rather than a generic 500: this is the state the
    // product is in until Stripe is configured, and a vague error here would
    // send somebody debugging their card instead of the deployment.
    return Response.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }

  let plan: PlanId;
  try {
    const body = (await req.json()) as { plan?: string };
    const match = PLANS.find((p) => p.id === body.plan);
    if (!match) {
      return Response.json({ error: "Unknown plan" }, { status: 400 });
    }
    plan = match.id;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const priceId = stripePriceId(plan);
  if (!priceId) {
    return Response.json(
      { error: `No Stripe price configured for ${plan}.` },
      { status: 503 },
    );
  }

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      stripeCustomerId: workspaces.stripeCustomerId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, viewer.workspace.id))
    .limit(1);

  if (!ws) return Response.json({ error: "No workspace" }, { status: 403 });

  // Reuse the Stripe customer if this workspace has one. Creating a second
  // customer for the same workspace splits their billing history in two and
  // makes the customer portal show them half of their own invoices.
  let customerId = ws.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: viewer.email,
      name: ws.name,
      // So a human looking at the Stripe dashboard can tell which workspace
      // this is without joining anything by hand.
      metadata: { workspaceId: String(ws.id) },
    });
    customerId = customer.id;
    await db
      .update(workspaces)
      .set({ stripeCustomerId: customerId })
      .where(eq(workspaces.id, ws.id));
  }

  const base = APP_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // BOTH of these carry the workspace id. client_reference_id is the one the
    // webhook reads; the subscription metadata is what survives onto every
    // later subscription.updated event, which arrives with no session at all.
    client_reference_id: String(ws.id),
    subscription_data: {
      metadata: { workspaceId: String(ws.id) },
    },
    success_url: `${base}/settings/billing?checkout=done`,
    cancel_url: `${base}/pricing`,
    allow_promotion_codes: true,
  });

  if (!session.url) {
    return Response.json({ error: "Stripe returned no URL" }, { status: 502 });
  }

  return Response.json({ url: session.url });
}

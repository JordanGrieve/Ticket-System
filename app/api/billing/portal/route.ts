import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { resolveViewer } from "@/lib/viewer";
import { stripeClient } from "@/lib/stripe";
import { APP_URL } from "@/lib/config";

/**
 * Send the customer to Stripe's billing portal.
 *
 * NOT optional, and not a nice-to-have. This is where somebody updates a card
 * and, more importantly, where they CANCEL. A subscription that can only be
 * cancelled by emailing the founder is a complaint waiting to happen and, for
 * UK consumers, a regulatory problem rather than a UX one. Stripe hosts the
 * whole thing, so the cost of getting this right is one endpoint.
 *
 * The customer id is read from the workspace resolved from the session — never
 * from the request. Accepting a customer id would let anybody open anybody
 * else's billing portal, which exposes their invoices, their card's last four
 * digits and their address.
 */
export async function POST(): Promise<Response> {
  const viewer = await resolveViewer();
  if (!viewer.workspace) {
    return Response.json({ error: "No workspace" }, { status: 403 });
  }

  const stripe = stripeClient();
  if (!stripe) {
    return Response.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }

  const [ws] = await db
    .select({ stripeCustomerId: workspaces.stripeCustomerId })
    .from(workspaces)
    .where(eq(workspaces.id, viewer.workspace.id))
    .limit(1);

  if (!ws?.stripeCustomerId) {
    // Never been to checkout, so there is nothing to manage. A 404 here would
    // read as a broken button; this says what is actually true.
    return Response.json(
      { error: "This workspace has no billing account yet." },
      { status: 409 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: ws.stripeCustomerId,
    return_url: `${APP_URL.replace(/\/$/, "")}/settings/billing`,
  });

  return Response.json({ url: session.url });
}

import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { getWorkspaceEntitlement } from "@/lib/billing-query";
import { PLANS, TRIAL_DAYS, formatPrice, planById } from "@/lib/pricing";
import { describeBlock } from "@/lib/trial";
import { stripeConfigured } from "@/lib/stripe";
import BillingActions from "./BillingActions";

export const metadata = { title: "Billing · Settings · Postbox" };

/**
 * Settings → Billing.
 *
 * What this workspace is on, what it may do, and how to change or stop it.
 * The "how to stop it" is not a courtesy: a subscription somebody can only
 * cancel by emailing us is a complaint waiting to happen, and for a UK
 * consumer a regulatory problem rather than a design one. Stripe's portal
 * handles it, so the cost of getting that right is one endpoint.
 *
 * Everything shown is derived from lib/trial.ts and lib/pricing.ts, so this
 * page cannot claim an entitlement the send path would refuse.
 */
export default async function BillingSettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const e = await getWorkspaceEntitlement(viewer.workspace.id);
  if (!e) redirect("/no-access");

  const currentPlan = e.plan === "trial" ? null : planById(e.plan);

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">Billing</h1>
        <p className="stg-sub">
          What <b>{viewer.workspace.name}</b> is on, and how to change it.
        </p>
      </header>

      <section className="stg-section">
        <h2 className="stg-section-title">
          {e.comped
            ? "Included, at no charge"
            : currentPlan
              ? currentPlan.name
              : "Free trial"}
        </h2>

        <p className="stg-section-sub">
          {e.comped ? (
            <>
              This workspace has full access to everything, with nothing to pay.
              If that is a surprise, get in touch and we will explain why.
            </>
          ) : currentPlan ? (
            <>
              {formatPrice(currentPlan.price)} a month. {currentPlan.tagline}
            </>
          ) : e.daysLeft !== null && e.daysLeft > 0 ? (
            <>
              {e.daysLeft === 1
                ? "Last day of your free trial."
                : `${e.daysLeft} days left of your ${TRIAL_DAYS}-day free trial.`}{" "}
              Choose a plan whenever you are ready — no card needed until you
              do.
            </>
          ) : (
            <>Your free trial has ended.</>
          )}
        </p>

        {/*
          The block reason, stated plainly. Always immediately followed by what
          still works: somebody reading this is worried about their customer
          mail, and the true answer is that it is completely unaffected.
        */}
        {e.blockedReason && (
          <p className="stg-identity-warn" role="status">
            {describeBlock(e.blockedReason)}
          </p>
        )}

        <p className="stg-section-sub">
          <b>Your inbox keeps working either way.</b> Enquiries from your
          customers are always received, recorded and repliable, whatever your
          billing state. Nothing on this page can cost you a customer&rsquo;s
          message.
        </p>
      </section>

      {stripeConfigured() ? (
        <BillingActions
          currentPlanId={e.plan === "trial" ? null : e.plan}
          canManage={!e.comped && currentPlan !== null}
          plans={PLANS.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            tagline: p.tagline,
          }))}
        />
      ) : (
        <section className="stg-section">
          <h2 className="stg-section-title">Payments are not set up yet</h2>
          <p className="stg-section-sub">
            We cannot take a payment on this deployment at the moment. Get in
            touch and we will sort it out with you directly.
          </p>
        </section>
      )}
    </div>
  );
}

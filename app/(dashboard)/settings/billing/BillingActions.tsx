"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/pricing";

type PlanSummary = {
  id: string;
  name: string;
  price: number;
  tagline: string;
};

/**
 * The two buttons on Settings → Billing.
 *
 * A client component because both actions are "POST, read the URL Stripe hands
 * back, go there" — there is nothing to render from the response, so a server
 * action would still need client code to perform the redirect.
 *
 * Everything disables while a request is in flight. Double-clicking "Choose"
 * would otherwise open two Checkout sessions; Stripe copes, but the customer
 * ends up with two tabs and no idea which one is real.
 */
export default function BillingActions({
  currentPlanId,
  canManage,
  plans,
}: {
  currentPlanId: string | null;
  /** Has been through checkout, so the Stripe portal has something to show. */
  canManage: boolean;
  plans: PlanSummary[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(url: string, key: string, body?: unknown) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        // Show what the server actually said. A generic "something went wrong"
        // would hide the one message that helps — that billing is not
        // configured on this deployment, or that there is nothing to manage
        // yet — and send somebody to check their card for no reason.
        setError(data.error ?? "Could not reach the payment page.");
        setBusy(null);
        return;
      }
      // assign() rather than `location.href = …`: the React Compiler lint
      // rejects assigning to a value defined outside the component, and a
      // method call expresses the same navigation without arguing with it.
      // Not router.push — Stripe's URL is a different origin.
      window.location.assign(data.url);
    } catch {
      setError("Could not reach the payment page. Please try again.");
      setBusy(null);
    }
  }

  return (
    <>
      <section className="stg-section">
        <h2 className="stg-section-title">
          {currentPlanId ? "Change plan" : "Choose a plan"}
        </h2>
        <p className="stg-section-sub">
          You are taken to Stripe to pay. We never see your card details.
        </p>

        <div className="stb-plans">
          {plans.map((p) => {
            const isCurrent = p.id === currentPlanId;
            return (
              <button
                key={p.id}
                type="button"
                className="stb-plan"
                data-current={isCurrent}
                disabled={isCurrent || busy !== null}
                onClick={() => go("/api/billing/checkout", p.id, { plan: p.id })}
              >
                <span className="stb-plan-name">{p.name}</span>
                <span className="stb-plan-price">
                  {formatPrice(p.price)}
                  <span className="stb-plan-per"> /month</span>
                </span>
                <span className="stb-plan-tag">{p.tagline}</span>
                <span className="stb-plan-cta">
                  {isCurrent
                    ? "Your plan"
                    : busy === p.id
                      ? "Opening Stripe…"
                      : "Choose"}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="stg-identity-warn" role="alert">
            {error}
          </p>
        )}
      </section>

      {canManage && (
        <section className="stg-section">
          <h2 className="stg-section-title">Invoices, card and cancelling</h2>
          <p className="stg-section-sub">
            Update your card, download invoices, or cancel. Cancelling takes
            effect at the end of the period you have already paid for — you keep
            what you bought.
          </p>
          <button
            type="button"
            className="stg-button"
            disabled={busy !== null}
            onClick={() => go("/api/billing/portal", "portal")}
          >
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </section>
      )}
    </>
  );
}

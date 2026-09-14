"use client";

import { useMemo } from "react";
import type { CampaignProduct } from "@/db/schema";
import {
  NO_BRAND,
  renderCampaign,
  safeImageUrl,
  type TemplateKey,
} from "@/lib/newsletter";

/**
 * What the welcome email will actually look like.
 *
 * ── WHY IT RUNS THE REAL RENDERER ──
 * Exactly the reasoning in the campaign composer's header, and it applies
 * harder here: a welcome sends UNATTENDED. Nobody proof-reads it before it
 * reaches the first subscriber, so this preview is the only chance anyone has
 * to see it. A preview that approximated the send would be worse than none,
 * because it would be believed.
 *
 * So `renderCampaign` is imported and its bytes go straight into `srcDoc` —
 * the same function, with the same inputs, that lib/welcome.ts calls. Nothing
 * here re-implements a shell, a paragraph splitter or a merge substitution.
 *
 * ── THE ADDRESS PLACEHOLDER ──
 * renderCampaign THROWS without a postal address, by design. A preview must
 * not be the thing that makes that legal requirement look optional, so the
 * placeholder is visibly a placeholder — the client reads it as the gap it is,
 * and the screen says so in words beside this.
 */

const PREVIEW_ADDRESS_PLACEHOLDER =
  "[your postal address — add one under Sender identity]";

export default function WelcomePreview({
  subject,
  body,
  templateKey,
  heroImageUrl,
  heroImageAlt,
  products,
  workspaceName,
  legalName,
  postalAddress,
  brandAccentHex,
  brandSignOff,
  viewerEmail,
}: {
  subject: string;
  body: string;
  templateKey: TemplateKey;
  heroImageUrl: string;
  heroImageAlt: string;
  products: CampaignProduct[];
  workspaceName: string;
  legalName: string | null;
  postalAddress: string | null;
  brandAccentHex: string | null;
  brandSignOff: string | null;
  /** Shown as the recipient, so the merge tags resolve to somebody real. */
  viewerEmail: string;
}) {
  /*
    The whole rendered email, not just its HTML.

    The header below showed the subject straight from the textarea, which meant
    it read "Thanks for subscribing to {company}" while the email itself said
    "Thanks for subscribing to Open Door Bakery". A preview that shows a merge
    tag the recipient never sees is a small lie in the one place whose entire
    job is to show what will be sent.
  */
  const rendered = useMemo(() => {
    const hero = safeImageUrl(heroImageUrl);
    try {
      return renderCampaign({
        campaign: { subject, body, preheader: null, templateKey },
        // The person looking at it. {first_name} has nothing to resolve from an
        // address alone, which is itself worth seeing: this is what a
        // subscriber who gave no name receives.
        recipient: { email: viewerEmail, name: null },
        workspaceName,
        // Inert. A live token here would be a working unsubscribe link sitting
        // in a preview, one stray click from removing the client from their
        // own list.
        unsubscribeUrl: "#preview",
        sender: {
          workspaceName,
          legalName,
          postalAddress: postalAddress ?? PREVIEW_ADDRESS_PLACEHOLDER,
        },
        brand: { ...NO_BRAND, accentHex: brandAccentHex, signOff: brandSignOff },
        hero: hero ? { url: hero, alt: heroImageAlt } : null,
        // Written long-hand rather than as shorthand, and deliberately:
        // tests/render-campaign-callers.test.ts requires every call site to
        // NAME what it carries, spelled `products:`. Two call sites have
        // already shipped having quietly dropped a client's image and
        // products, so the guard is strict and this bends to it rather than
        // the other way round.
        products: products,
      });
    } catch (err) {
      // Never a blank panel. The renderer refuses for stateable reasons and the
      // client is the only person who can act on them. The subject falls back
      // to what they typed, unrendered, because there is nothing better.
      return {
        subject,
        html: `<p style="font:14px system-ui;padding:16px;color:#611">This can't be previewed yet: ${
          err instanceof Error ? err.message : "unknown error"
        }</p>`,
        text: "",
      };
    }
  }, [
    subject,
    body,
    templateKey,
    heroImageUrl,
    heroImageAlt,
    products,
    workspaceName,
    legalName,
    postalAddress,
    brandAccentHex,
    brandSignOff,
    viewerEmail,
  ]);

  return (
    <div className="stg-preview">
      <div className="stg-preview-head">
        <span className="stg-field-label">Preview</span>
        {/* The RENDERED subject — what lands in the inbox, merge tags filled
            in — not the text in the box above. */}
        <span className="stg-preview-subject" title={rendered.subject}>
          {rendered.subject || "No subject yet"}
        </span>
      </div>
      {/*
        Sandboxed with no allow-* flags, so the email's own HTML cannot run a
        script, navigate the page or reach the app's storage. The bytes are the
        product and they are quarantined; see the composer's note on why email
        HTML is allowed to carry its own colours at all.
      */}
      <iframe
        className="stg-preview-frame"
        title="Welcome email preview"
        sandbox=""
        srcDoc={rendered.html}
      />
    </div>
  );
}

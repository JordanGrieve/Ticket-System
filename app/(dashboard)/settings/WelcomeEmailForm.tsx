"use client";

import { useMemo, useRef, useState } from "react";
import type { CampaignProduct } from "@/db/schema";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/newsletter";
import ProductsHeroEditor, {
  blankDraftProduct,
  draftProductFrom,
  type DraftProduct,
  type HeroAndProducts,
} from "@/components/newsletter/ProductsHeroEditor";
import WelcomePreview from "./WelcomePreview";

/**
 * The welcome newsletter — what a new subscriber gets the moment they sign up.
 *
 * ── WHY IT SITS UNDER NEWSLETTER BRANDING AND NOT IN ITS OWN TAB ──
 * The settings strip already carries nine tabs and overflows on a phone, and
 * this belongs beside the other "what your newsletter emails say" controls
 * rather than becoming a tenth.
 *
 * ── ON BY DEFAULT, SINCE 14 SEP 2026 ──
 * It was off, with the note that "shipping a default that starts mailing a
 * client's customers is not a feature". That was right when signups were
 * double opt-in: the subscriber had just clicked a link and been told they
 * were on the list. Under single opt-in this email is the only acknowledgement
 * they get, and the only unsubscribe route for somebody a stranger typed into
 * a public form — so off by default meant three real people subscribing to a
 * client's list and hearing nothing at all. See db/schema.ts.
 *
 * ── IT IS A NEWSLETTER, NOT A NOTE ──
 * Layout, a photograph and products, the same pieces a campaign has and
 * validated by the same functions. Jordan, 14 Sep 2026: it should be "one that
 * whoever they sign up to has customised, so it's personal and nothing to do
 * with Postbox". The branding was already theirs; what it could CONTAIN was a
 * paragraph of text.
 *
 * No lib/config import, direct or transitive — client component, same rule as
 * the two forms above it. lib/newsletter is pure and safe to import here; it
 * is what the preview runs.
 */
export default function WelcomeEmailForm({
  initial,
  hasPostalAddress,
  workspaceName,
  legalName,
  postalAddress,
  brandAccentHex,
  brandSignOff,
  viewerEmail,
}: {
  initial: {
    enabled: boolean;
    subject: string;
    body: string;
    templateKey: TemplateKey;
    heroImageUrl: string | null;
    heroImageAlt: string | null;
    products: CampaignProduct[];
  };
  /** Everything below is for the preview, which runs the real renderer. */
  workspaceName: string;
  legalName: string | null;
  postalAddress: string | null;
  brandAccentHex: string | null;
  brandSignOff: string | null;
  viewerEmail: string;
  /**
   * Whether Sender identity has an address. Without one the email cannot be
   * rendered at all (it is marketing mail and must carry one), so the screen
   * says that here rather than letting somebody turn a feature on that will
   * silently refuse every time.
   */
  hasPostalAddress: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [templateKey, setTemplateKey] = useState<TemplateKey>(initial.templateKey);
  // Held as strings, empty for "none". The server turns empty into null; a
  // null in the input would render the word "null" in the box.
  const [heroUrl, setHeroUrl] = useState(initial.heroImageUrl ?? "");
  const [heroAlt, setHeroAlt] = useState(initial.heroImageAlt ?? "");
  // Row ids are minted here, not from a module counter: the initial rows are
  // server-rendered, and their ids are in the DOM (label `for`), so they must
  // come out the same on the server and in the browser. 1..n does.
  const [products, setProducts] = useState<DraftProduct[]>(() =>
    initial.products.map((p, i) => draftProductFrom(p, i + 1)),
  );
  const nextProductId = useRef(initial.products.length + 1);
  /**
   * Back to the saved shape, id dropped. Exactly what this form used to hold
   * and send — an empty field is null, nothing is trimmed, a nameless row is
   * left for parseProducts to skip — so the save payload is unchanged.
   */
  const productList = useMemo<CampaignProduct[]>(
    () =>
      products.map((p) => ({
        name: p.name,
        price: p.price || null,
        imageUrl: p.imageUrl || null,
        url: p.url || null,
      })),
    [products],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  /** What the last test send did. The reason is shown, not swallowed. */
  const [test, setTest] = useState<string | null>(null);

  function touch() {
    setSaved(false);
    setError(null);
  }

  function patchMedia(next: Partial<HeroAndProducts>) {
    if (next.heroImageUrl !== undefined) setHeroUrl(next.heroImageUrl);
    if (next.heroImageAlt !== undefined) setHeroAlt(next.heroImageAlt);
    if (next.products !== undefined) setProducts(next.products);
    touch();
  }

  async function save(next?: { enabled: boolean }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/welcome", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next ? next.enabled : enabled,
          subject,
          body,
          templateKey,
          heroImageUrl: heroUrl,
          heroImageAlt: heroAlt,
          // Sent whole rather than as a diff. parseProducts validates the list
          // as a list — the count cap among other things — so half of one is
          // not a thing the server can check.
          products: productList,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Couldn’t save that.");
        // Put the toggle back: the screen must not show something on that the
        // server refused to turn on.
        if (next) setEnabled(!next.enabled);
        return;
      }
      if (next) setEnabled(next.enabled);
      setSaved(true);
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
      if (next) setEnabled(!next.enabled);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Send it to yourself.
   *
   * The response carries the refusal REASON, unlike every other send in the
   * product — safe here because it goes to the caller's own address and the
   * person reading it is the only one who can fix it. Without this, a welcome
   * that does not arrive is a silence with five possible causes.
   */
  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/welcome/test", { method: "POST" });
      const p = (await res.json()) as {
        sent?: boolean;
        to?: string;
        message?: string;
        detail?: string;
        error?: string;
      };
      if (!res.ok) setTest(p.error ?? "Couldn’t send a test.");
      else if (p.sent) setTest(`Sent to ${p.to}. Check the footer carries your postal address.`);
      else setTest([p.message, p.detail].filter(Boolean).join(" — "));
    } catch {
      setTest("Couldn’t reach the server.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="stg-identity">
      <div className="stg-switch-row">
        <span className="stg-field-label">Send a thank-you when somebody subscribes</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Send a thank-you when somebody subscribes"
          className="st-switch"
          data-on={enabled}
          disabled={saving || !hasPostalAddress}
          onClick={() => void save({ enabled: !enabled })}
        >
          <span className="st-switch-knob" aria-hidden />
        </button>
      </div>

      {!hasPostalAddress && (
        <p className="stg-identity-warn" role="status">
          <b>Postal address missing</b> — add one under Sender identity above.
        </p>
      )}

      <label className="stg-field">
        <span className="stg-field-label">Subject</span>
        <input
          className="stg-input"
          type="text"
          value={subject}
          maxLength={200}
          disabled={saving}
          onChange={(e) => {
            setSubject(e.target.value);
            touch();
          }}
        />
      </label>

      <label className="stg-field">
        <span className="stg-field-label">Message</span>
        <textarea
          className="stg-input stg-textarea"
          value={body}
          rows={10}
          maxLength={5000}
          disabled={saving}
          onChange={(e) => {
            setBody(e.target.value);
            touch();
          }}
        />
        <span className="stg-field-hint">
          {"{first_name}"} and {"{company}"} are filled in when it sends. The
          unsubscribe link and your postal address are added automatically.
        </span>
      </label>

      <fieldset className="stg-fieldset">
        <legend className="stg-field-label">Layout</legend>
        <div className="stg-seg">
          {TEMPLATE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="stg-seg-btn"
              data-on={templateKey === key}
              aria-pressed={templateKey === key}
              disabled={saving}
              onClick={() => {
                setTemplateKey(key);
                touch();
              }}
            >
              {key === "branded" ? "Branded" : "Plain"}
            </button>
          ))}
        </div>
        <span className="stg-field-hint">
          Branded uses your colour and sign-off. Plain is text on white.
        </span>
      </fieldset>

      {/* The composer's editor, so the two cannot drift: visible labels on
          every input, and rows keyed by id rather than position. */}
      <ProductsHeroEditor
        heroImageUrl={heroUrl}
        heroImageAlt={heroAlt}
        products={products}
        disabled={saving}
        onChange={patchMedia}
        newProduct={() => blankDraftProduct(nextProductId.current++)}
      />

      <WelcomePreview
        subject={subject}
        body={body}
        templateKey={templateKey}
        heroImageUrl={heroUrl}
        heroImageAlt={heroAlt}
        products={productList}
        workspaceName={workspaceName}
        legalName={legalName}
        postalAddress={postalAddress}
        brandAccentHex={brandAccentHex}
        brandSignOff={brandSignOff}
        viewerEmail={viewerEmail}
      />

      <div className="stg-identity-actions">
        <button
          className="stg-button"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="stg-link-btn"
          type="button"
          disabled={testing || saving}
          onClick={() => void sendTest()}
        >
          {testing ? "Sending…" : "Send me a test"}
        </button>
        {saved && (
          <span className="stg-identity-ok" role="status">
            Saved
          </span>
        )}
        {error && (
          <span className="stg-identity-error" role="alert">
            {error}
          </span>
        )}
      </div>

      {test && (
        <p className="stg-field-hint" role="status">
          {test}
        </p>
      )}
    </div>
  );
}

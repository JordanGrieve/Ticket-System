"use client";

import { useState } from "react";
import type { CampaignProduct } from "@/db/schema";
import { MAX_PRODUCTS, TEMPLATE_KEYS, type TemplateKey } from "@/lib/newsletter";
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
  const [products, setProducts] = useState<CampaignProduct[]>(initial.products);
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
          products,
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

      <label className="stg-field">
        <span className="stg-field-label">Image (optional)</span>
        <input
          className="stg-input"
          type="url"
          inputMode="url"
          placeholder="https://yourshop.com/photo.jpg"
          value={heroUrl}
          disabled={saving}
          onChange={(e) => {
            setHeroUrl(e.target.value);
            touch();
          }}
        />
        <span className="stg-field-hint">
          A photo above the message — hosted on your own site or shop. It has to
          start with https://
        </span>
      </label>

      {heroUrl.trim() !== "" && (
        <label className="stg-field">
          <span className="stg-field-label">Describe the image</span>
          <input
            className="stg-input"
            type="text"
            maxLength={200}
            value={heroAlt}
            disabled={saving}
            onChange={(e) => {
              setHeroAlt(e.target.value);
              touch();
            }}
          />
          {/* Not an accessibility nicety here — a plain necessity. Gmail and
              Outlook block remote images from an unfamiliar sender, and a
              welcome email is the most unfamiliar a sender ever is, so for
              most recipients this text IS the image. */}
          <span className="stg-field-hint">
            Most people will see these words instead of the picture: mail apps
            hide images from senders they don&rsquo;t know yet.
          </span>
        </label>
      )}

      <fieldset className="stg-fieldset">
        <legend className="stg-field-label">Products (optional)</legend>
        {products.length === 0 && (
          <p className="stg-field-hint">
            Nothing yet. Add a few pieces to show them what you sell.
          </p>
        )}
        {products.map((product, i) => (
          <div className="stg-product" key={i}>
            <input
              className="stg-input"
              type="text"
              placeholder="Name"
              aria-label={`Product ${i + 1} name`}
              value={product.name}
              disabled={saving}
              onChange={(e) => {
                setProducts(
                  products.map((p, n) =>
                    n === i ? { ...p, name: e.target.value } : p,
                  ),
                );
                touch();
              }}
            />
            <input
              className="stg-input"
              type="text"
              placeholder="Price"
              aria-label={`Product ${i + 1} price`}
              value={product.price ?? ""}
              disabled={saving}
              onChange={(e) => {
                setProducts(
                  products.map((p, n) =>
                    n === i ? { ...p, price: e.target.value || null } : p,
                  ),
                );
                touch();
              }}
            />
            <input
              className="stg-input"
              type="url"
              placeholder="Image link (https://)"
              aria-label={`Product ${i + 1} image link`}
              value={product.imageUrl ?? ""}
              disabled={saving}
              onChange={(e) => {
                setProducts(
                  products.map((p, n) =>
                    n === i ? { ...p, imageUrl: e.target.value || null } : p,
                  ),
                );
                touch();
              }}
            />
            <input
              className="stg-input"
              type="url"
              placeholder="Buy link (https://)"
              aria-label={`Product ${i + 1} buy link`}
              value={product.url ?? ""}
              disabled={saving}
              onChange={(e) => {
                setProducts(
                  products.map((p, n) =>
                    n === i ? { ...p, url: e.target.value || null } : p,
                  ),
                );
                touch();
              }}
            />
            <button
              type="button"
              className="stg-link-btn"
              disabled={saving}
              // Named with the product, because "Remove" four times over is
              // four identical controls to anyone listing them.
              aria-label={`Remove ${product.name || `product ${i + 1}`}`}
              onClick={() => {
                setProducts(products.filter((_, n) => n !== i));
                touch();
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {products.length < MAX_PRODUCTS && (
          <button
            type="button"
            className="stg-button stg-button--secondary"
            disabled={saving}
            onClick={() => {
              setProducts([
                ...products,
                { name: "", price: null, imageUrl: null, url: null },
              ]);
              touch();
            }}
          >
            Add a product
          </button>
        )}
      </fieldset>

      <WelcomePreview
        subject={subject}
        body={body}
        templateKey={templateKey}
        heroImageUrl={heroUrl}
        heroImageAlt={heroAlt}
        products={products}
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

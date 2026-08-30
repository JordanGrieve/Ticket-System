"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_EMAIL_ACCENT,
  SIGN_OFF_MAX,
  emailAccent,
} from "@/lib/newsletter";

/**
 * How a workspace's newsletters look — accent colour and sign-off.
 *
 * ── DELIBERATELY NOT NEXT TO SENDER IDENTITY ──
 * They are both "things in the newsletter footer" and they could not be more
 * different. The postal address is a legal duty whose absence STOPS a send;
 * these two are decoration whose absence changes nothing. Putting them in one
 * card would teach a client that both are optional, or that both are
 * mandatory, and either lesson is the wrong one.
 *
 * ── WHY THE SWATCH IS NOT WHAT THEY PICKED ──
 * The preview below shows the colour the EMAIL will use, which is not always
 * the colour in the picker. A brand colour is chosen to look good on a
 * shopfront, and a good few are unreadable as 14px link text — a pale yellow
 * measures about 1.3:1 on white, which is invisible rather than merely poor.
 * lib/email-colour.ts darkens those until they pass 4.5:1 and leaves the rest
 * exactly as authored.
 *
 * The alternative was to refuse pale colours outright. That is worse: it tells
 * somebody their brand is wrong, when the honest answer is that links have to
 * be readable and everything else about their colour is kept. So the screen
 * shows both, and says which is which, rather than arguing.
 *
 * No lib/config import, direct or transitive — client component, same note as
 * SenderIdentityForm. lib/newsletter.ts and lib/email-colour.ts are both pure
 * and safe to reach from here; that is the whole point of their purity.
 */
export default function NewsletterBrandForm({
  brandAccentHex,
  brandSignOff,
  workspaceName,
}: {
  brandAccentHex: string | null;
  brandSignOff: string | null;
  /** Used to make the sign-off placeholder read like a real one. */
  workspaceName: string;
}) {
  const router = useRouter();
  const [accent, setAccent] = useState(brandAccentHex ?? DEFAULT_EMAIL_ACCENT);
  const [signOff, setSignOff] = useState(brandSignOff ?? "");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();

  // Same reasoning as SenderIdentityForm: compared against the props, so a
  // successful save clears this on its own when the parent re-renders.
  const usingDefault = brandAccentHex === null;
  const dirty =
    (usingDefault ? DEFAULT_EMAIL_ACCENT !== accent : brandAccentHex !== accent) ||
    signOff.trim() !== (brandSignOff ?? "").trim();

  // The renderer's own function, not a copy of its rules. If the contrast
  // floor ever moves, this screen moves with it.
  const asSent = emailAccent(accent, "#ffffff");
  const adjusted = asSent.toLowerCase() !== accent.toLowerCase();

  async function save(patch: { brandAccentHex?: string; brandSignOff?: string }) {
    setStatus("idle");
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      setStatus("saved");
      startTransition(() => router.refresh());
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="stg-identity">
      <p className="stg-section-sub">
        Used for links and the header rule in your newsletters. Your inbox
        replies are unaffected — those are sent as plain text, so they read
        like a message from a person rather than a mailout.
      </p>

      <label className="stg-field">
        <span className="stg-field-label">Accent colour</span>
        <span className="stg-brand-row">
          <input
            className="stg-colour"
            type="color"
            value={accent}
            disabled={pending}
            onChange={(e) => {
              setAccent(e.target.value);
              setStatus("idle");
            }}
            aria-label="Accent colour"
          />
          {/*
            aria-hidden: the swatch and the words say the same thing, and a
            screen reader announcing a hex twice is noise. The sentence below
            carries the meaning.
          */}
          <span
            className="stg-brand-sample"
            style={{ color: asSent }}
            aria-hidden
          >
            Read the full story
          </span>
          {!usingDefault && (
            <button
              type="button"
              className="stg-brand-reset"
              disabled={pending}
              onClick={() => {
                setAccent(DEFAULT_EMAIL_ACCENT);
                void save({ brandAccentHex: "" });
              }}
            >
              Use the default
            </button>
          )}
        </span>
        <span className="stg-field-hint">
          {adjusted ? (
            <>
              Your colour is too light to read as a link, so emails use{" "}
              <b>{asSent}</b> — the closest shade of it that stays legible.
              Everything else keeps the colour you picked.
            </>
          ) : (
            <>
              Links in your newsletters will be <b>{asSent}</b>.
            </>
          )}
        </span>
      </label>

      <label className="stg-field">
        <span className="stg-field-label">Sign-off</span>
        <input
          className="stg-input"
          type="text"
          value={signOff}
          maxLength={SIGN_OFF_MAX}
          disabled={pending}
          onChange={(e) => {
            setSignOff(e.target.value);
            setStatus("idle");
          }}
          placeholder={`— Emma, ${workspaceName}`}
        />
        <span className="stg-field-hint">
          Added to the end of every newsletter, above the unsubscribe line, so
          the message ends with a person rather than with the small print.
          Leave it empty for none.
        </span>
      </label>

      <div className="stg-identity-actions">
        <button
          className="stg-button"
          type="button"
          onClick={() =>
            save({ brandAccentHex: accent, brandSignOff: signOff })
          }
          disabled={pending || !dirty}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {status === "saved" && !dirty && (
          <span className="stg-identity-ok">Saved.</span>
        )}
        {status === "error" && (
          <span className="stg-identity-error">
            Couldn&rsquo;t save that — please try again.
          </span>
        )}
      </div>
    </div>
  );
}

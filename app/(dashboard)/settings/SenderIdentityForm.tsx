"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Legal name and postal address — the CAN-SPAM identification block.
 *
 * ── WHY THIS SCREEN EXISTS ──
 * Every commercial email must carry a valid physical postal address. The
 * columns behind this form are nullable on purpose (db/schema.ts): a fake
 * address in a real marketing email is worse than not sending at all, because
 * it is an affirmative falsehood in the one field the statute is about. So
 * nothing is defaulted, nothing is guessed, and an empty address stops the
 * workspace sending rather than producing a footer that quietly omits it.
 *
 * That makes this form the gate on the whole newsletter product for a
 * workspace, which is why the empty state is stated as a consequence — "you
 * cannot send until this is filled in" — rather than as a neutral hint.
 *
 * NOTE: no lib/config import, direct or transitive. Client component; see the
 * same note on ThemePicker and the header of app/(dashboard)/settings/page.tsx.
 */
export default function SenderIdentityForm({
  legalName,
  postalAddress,
  workspaceName,
}: {
  legalName: string | null;
  postalAddress: string | null;
  /** Shown as the fallback the footer will use when no legal name is set. */
  workspaceName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(legalName ?? "");
  const [address, setAddress] = useState(postalAddress ?? "");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();

  // Compared against the props rather than a ref: after a successful save the
  // parent re-renders with the new values, so this goes back to false on its
  // own without a second piece of state to keep in step.
  const dirty =
    name.trim() !== (legalName ?? "").trim() ||
    address.trim() !== (postalAddress ?? "").trim();

  const willSend = address.trim().length > 0;

  async function save() {
    setStatus("idle");
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Sent as strings, including empty ones. "" is an explicit clear —
        // somebody who typed the wrong address has to be able to remove it.
        body: JSON.stringify({ legalName: name, postalAddress: address }),
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
        Required by law in every marketing email you send. It appears in the
        footer, beside the unsubscribe link.
      </p>

      {!willSend && (
        <p className="stg-identity-warn" role="status">
          <b>You cannot send a newsletter until this is filled in.</b> Postbox
          refuses the send rather than leaving the address out — an email
          missing it is unlawful, and a made-up one is worse.
        </p>
      )}

      <label className="stg-field">
        <span className="stg-field-label">Registered or trading name</span>
        <input
          className="stg-input"
          type="text"
          value={name}
          maxLength={200}
          disabled={pending}
          onChange={(e) => {
            setName(e.target.value);
            setStatus("idle");
          }}
          placeholder={workspaceName}
        />
        <span className="stg-field-hint">
          Optional. Left empty, the footer uses <b>{workspaceName}</b>.
        </span>
      </label>

      <label className="stg-field">
        <span className="stg-field-label">Postal address</span>
        <textarea
          className="stg-input stg-textarea"
          value={address}
          rows={3}
          maxLength={500}
          disabled={pending}
          onChange={(e) => {
            setAddress(e.target.value);
            setStatus("idle");
          }}
          placeholder={"12 High Street\nHarrogate\nHG1 1AA"}
        />
        <span className="stg-field-hint">
          A real address where you can receive post. A PO box or registered
          office is fine; an address you do not control is not.
        </span>
      </label>

      <div className="stg-identity-actions">
        <button
          className="stg-button"
          type="button"
          onClick={save}
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

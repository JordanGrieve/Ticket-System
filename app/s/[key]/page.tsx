import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWorkspaceByApiKey } from "@/lib/data";
import { HONEYPOT_FIELDS, SUBSCRIBER_NAME_MAX } from "@/lib/subscribe";

export const metadata: Metadata = {
  title: "Subscribe — Postbox",
};

/**
 * The hosted signup form.
 *
 * A client who cannot or will not paste HTML into their own site links here
 * instead. Same endpoint, same rules, same double opt-in — the only difference
 * is who hosts the markup.
 *
 * ── THE WORKSPACE NAME IS THE ONLY THING READ ──
 * The key in the URL is the workspace's PUBLIC ingestion key; it already lives
 * in the client's page source wherever the snippet is pasted, so resolving it
 * here reveals nothing that was not already published. An unknown key renders
 * a 404 rather than an empty form, because a form that posts to a dead
 * endpoint is worse than no form.
 *
 * ── NO JAVASCRIPT ──
 * A plain HTML form with a real `action`, like app/u/[token]/confirm/page.tsx.
 * It works with scripting disabled and in text browsers, and it means the
 * hosted page and the pasted snippet are the same mechanism rather than two
 * code paths that can drift apart.
 */
export default async function HostedSignupPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  const workspace = await getWorkspaceByApiKey(key);
  if (!workspace) notFound();

  return (
    <div className="s-card">
      <h1>Subscribe to {workspace.name}</h1>
      <p>
        Enter your email and we&rsquo;ll send you a link to confirm. You
        won&rsquo;t receive anything until you press it.
      </p>

      <form method="post" action={`/api/subscribe/${encodeURIComponent(key)}`}>
        <label className="s-field">
          <span className="s-label">Your name (optional)</span>
          <input
            className="s-input"
            type="text"
            name="name"
            autoComplete="name"
            maxLength={SUBSCRIBER_NAME_MAX}
          />
        </label>

        <label className="s-field">
          <span className="s-label">Email address</span>
          <input
            className="s-input"
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>

        {/*
          The honeypot fields, rendered from the shared constant so this page
          and the pasted snippet can never disagree about their names — a trap
          the server checks but the form stopped emitting is a trap that
          catches nothing, and nothing would fail loudly to say so.
        */}
        <div className="s-trap" aria-hidden="true">
          {HONEYPOT_FIELDS.map((field) => (
            <input
              key={field}
              type="text"
              name={field}
              tabIndex={-1}
              autoComplete="off"
            />
          ))}
        </div>

        <button className="s-button" type="submit">
          Subscribe
        </button>
      </form>

      <p className="s-fine" style={{ marginTop: 18, marginBottom: 0 }}>
        You can unsubscribe at any time using the link in any email we send.
      </p>
    </div>
  );
}

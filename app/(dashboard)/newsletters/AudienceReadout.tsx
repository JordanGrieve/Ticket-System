import { AUDIENCE_SKIP_REASONS } from "@/lib/newsletter";
import { SKIP_LABELS, type AudienceState } from "./composer-model";

// ── Audience readout ─────────────────────────────────────────────

/**
 * The recipient count, or an honest reason there isn't one.
 *
 * Never renders a number it did not receive from the server. "Unknown" is a
 * legitimate state here and is shown as such: an audience figure that is a
 * guess is the one number on this screen that could cause real-world harm.
 */
export default function AudienceReadout({
  state,
}: {
  state: AudienceState;
}) {
  if (state.kind === "unsaved") {
    return <p className="nl-help">Save the draft to count its audience.</p>;
  }

  if (state.kind === "loading") {
    return (
      <p className="nl-help" role="status">
        Counting…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="nl-error" role="alert">
        {state.message}
      </p>
    );
  }

  const { data } = state;
  const skips = AUDIENCE_SKIP_REASONS.filter((r) => data.skipped[r] > 0);

  return (
    <div className="nl-count">
      <p className="nl-count-num">
        <b>{data.recipientCount.toLocaleString()}</b>{" "}
        {data.recipientCount === 1 ? "person" : "people"} would be mailed
      </p>
      <p className="nl-help">
        From {data.candidateCount.toLocaleString()} on the list, after removing
        suppressions, duplicates and anyone unsubscribed.
      </p>

      {skips.length > 0 && (
        <ul className="nl-skips">
          {skips.map((r) => (
            <li key={r} className="nl-skip">
              <span className="nl-skip-n">
                {data.skipped[r].toLocaleString()}
              </span>
              <span className="nl-skip-l">{SKIP_LABELS[r]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

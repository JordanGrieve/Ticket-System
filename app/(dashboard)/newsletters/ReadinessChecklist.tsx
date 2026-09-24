import type { ReadinessStep } from "@/lib/campaign-readiness";

/**
 * ── THE CHECKLIST ──
 * Every condition the primary button waits on, as a list with ticks, each
 * unmet one a link to where it is fixed. lib/campaign-readiness.ts decides the
 * ticks; this draws them. Before this there were five disabled buttons and one
 * grey line naming the first unmet step.
 */
export default function ReadinessChecklist({
  steps,
  onFix,
}: {
  steps: ReadinessStep[];
  onFix: (fix: ReadinessStep["fix"]) => void;
}) {
  return (
    <ol className="nl-ready" aria-label="Before this can send">
      {steps.map((s) => (
        <li key={s.key} className="nl-ready-item" data-done={s.done || undefined}>
          <span className="nl-ready-tick" aria-hidden>
            {s.done ? "✓" : ""}
          </span>
          {s.done ? (
            <span className="nl-ready-label">{s.label}</span>
          ) : (
            <button
              type="button"
              className="nl-ready-fix"
              onClick={() => onFix(s.fix)}
            >
              <span className="nl-ready-label">{s.label}</span>
              <span className="nl-ready-go" aria-hidden>
                →
              </span>
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

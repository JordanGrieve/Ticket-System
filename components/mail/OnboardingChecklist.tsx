import Link from "next/link";
import type { OnboardingProgress } from "@/lib/onboarding";
import "./onboarding.css";

/**
 * The setup checklist, rendered where the "pick a thread" placeholder goes.
 *
 * ── WHY HERE AND NOT A BANNER OR A MODAL ──
 * A modal would make somebody dismiss a sales interruption before they can
 * answer a customer, which is the opposite of what a support inbox is for. A
 * banner would push the ticket list down on every page for everybody.
 *
 * The empty thread pane is the one piece of screen that is genuinely doing
 * nothing: on a brand new workspace there are no tickets to open, so it says
 * "pick a message on the left" about a list with nothing in it. Putting the
 * checklist there costs no space that was being used, and it disappears the
 * moment somebody opens a thread — which is to say, the moment they are busy.
 *
 * ── IT CAN NOW BE DISMISSED FOR GOOD ──
 * This said the opposite until 28 August, and the old argument is worth
 * keeping in view: the list occupies dead space, covers nothing, and removes
 * itself once the required steps are done, so hiding it can only hide the
 * things standing between somebody and a working product.
 *
 * What that misses is the reader who has decided they are never turning on an
 * auto-reply. They are shown an unfinishable list every time they open an
 * empty thread pane and given no way to say so, and making that decision for
 * them is the part that does not hold. The dismissal lives in
 * OnboardingDismiss, which explains the rest.
 *
 * Steps are derived from the database, never ticked by hand — see
 * lib/onboarding.ts.
 */
export default function OnboardingChecklist({
  progress,
}: {
  progress: OnboardingProgress;
}) {
  const { steps, done, total } = progress;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);

  return (
    <section
      className="pbo-card"
      aria-labelledby="pbo-title"
      data-hide-mobile={undefined}
    >
      <header className="pbo-head">
        <h2 className="pbo-title" id="pbo-title">
          Get set up
        </h2>
        <p className="pbo-sub">
          {done === 0
            ? "Four short things and your inbox is doing real work."
            : done === total
              ? "That is everything essential done."
              : `${done} of ${total} done.`}
        </p>

        <div
          className="pbo-bar"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Setup progress: ${done} of ${total} steps done`}
        >
          <span className="pbo-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <ol className="pbo-steps">
        {steps.map((step) => (
          <li className="pbo-step" key={step.id} data-done={step.done}>
            <span className="pbo-check" aria-hidden>
              {step.done ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              ) : null}
            </span>

            <span className="pbo-body">
              <span className="pbo-step-title">
                {step.title}
                {step.optional && (
                  <span className="pbo-optional"> · optional</span>
                )}
              </span>
              {/*
                The reason is shown only while the step is outstanding. Once it
                is done the explanation is just noise between the reader and
                the thing they have not done yet.
              */}
              {!step.done && (
                <span className="pbo-detail">{step.detail}</span>
              )}
            </span>

            {!step.done && (
              <Link className="pbo-go" href={step.href}>
                Do it
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The setup checklist a new workspace sees until it is actually set up.
 *
 * Pure: no database, no network. The facts come in, the steps come out, so the
 * ordering and the wording can be proved without a deployment.
 *
 * ── EVERY STEP IS DERIVED, NOT TICKED ──
 * There is no "mark as done" button and no per-step flag in the database. Each
 * step is computed from evidence that the thing has actually happened: a
 * ticket that arrived through a contact form proves the snippet is live on a
 * real website far better than somebody clicking "I did this". A checklist you
 * tick yourself drifts from reality the first time somebody clicks ahead, and
 * then it is worse than no checklist, because it says the form is connected
 * when no form is connected.
 *
 * The cost is that a step can un-tick — turn the auto-reply off and step two
 * comes back. That is correct: it is describing the workspace as it is now,
 * not a history of buttons pressed.
 *
 * ── ORDER IS THE ORDER OF VALUE ──
 * Connect the form first, because until an enquiry can reach the inbox nothing
 * else in the product does anything. The postal address sits above subscribers
 * deliberately: it is the one field that makes a newsletter send legally
 * possible, and discovering it is missing at send time — with a campaign
 * written and an audience waiting — is the worst moment to find out.
 */

export type OnboardingStepId =
  | "connect_form"
  | "auto_reply"
  | "postal_address"
  | "first_subscriber"
  | "invite_team";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  /** What this unlocks, in the client's terms. One sentence. */
  detail: string;
  done: boolean;
  /** Where to go to do it. */
  href: string;
  /** Skippable steps do not hold back "you're set up". */
  optional: boolean;
};

export type OnboardingFacts = {
  /** A ticket has arrived through a contact form. */
  hasFormTicket: boolean;
  /** Any ticket at all, from any source. */
  hasAnyTicket: boolean;
  /** An auto-reply exists AND is switched on. */
  autoReplyEnabled: boolean;
  /** A non-blank postal address is stored. */
  hasPostalAddress: boolean;
  /** At least one confirmed subscriber. */
  hasSubscriber: boolean;
  /** More than one person can sign in. */
  hasTeammate: boolean;
  /**
   * Newsletters are part of this workspace's plan.
   *
   * Starter is inbox-only, so for a Starter customer "get your first
   * subscriber" is not a step they have not done yet — it is a step they
   * cannot do, and a postal address is not required of them either. Leaving
   * both in would give them a checklist that can never finish, which reads as
   * the product being broken rather than as a plan boundary.
   *
   * True during a trial: a trial has the full product.
   */
  newslettersAvailable: boolean;
};

export function onboardingSteps(f: OnboardingFacts): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      id: "connect_form",
      title: "Connect your contact form",
      detail:
        "Put the snippet on your website so enquiries land here instead of in a personal inbox.",
      // Any ticket counts, not just a form one: a workspace forwarding its
      // support email is just as connected, and telling somebody their form
      // is not set up while their mail is arriving would be plainly wrong.
      done: f.hasFormTicket || f.hasAnyTicket,
      href: "/settings/install",
      optional: false,
    },
    {
      id: "auto_reply",
      title: "Turn on your auto-reply",
      detail:
        "Tell people you have got their message. Out of hours it waits until you open rather than claiming somebody is around at 2am.",
      done: f.autoReplyEnabled,
      href: "/settings/auto-reply",
      optional: false,
    },
    {
      id: "postal_address",
      title: "Add your postal address",
      detail:
        "Required by law in every marketing email. We refuse to send newsletters without it, so it is worth doing before you write one.",
      done: f.hasPostalAddress,
      href: "/settings",
      optional: false,
    },
    {
      id: "first_subscriber",
      title: "Get your first subscriber",
      detail:
        "Add a signup form to your site, or share your hosted signup link. Everyone confirms their own address by email.",
      done: f.hasSubscriber,
      href: "/settings/install",
      optional: false,
    },
    {
      id: "invite_team",
      title: "Invite your team",
      detail:
        "Anyone you invite sees the same inbox and replies as the business. Skip it if it is just you.",
      done: f.hasTeammate,
      href: "/settings/team",
      optional: true,
    },
  ];

  // Drop the newsletter half for a plan that does not include it, rather than
  // showing steps that can never be completed.
  return f.newslettersAvailable
    ? steps
    : steps.filter(
        (s) => s.id !== "postal_address" && s.id !== "first_subscriber",
      );
}

export type OnboardingProgress = {
  steps: OnboardingStep[];
  /** Required steps completed. */
  done: number;
  /** Required steps in total. */
  total: number;
  /** Every REQUIRED step is done. Optional ones do not hold this back. */
  complete: boolean;
  /** The next thing worth doing, or null when there is nothing left. */
  next: OnboardingStep | null;
};

export function onboardingProgress(f: OnboardingFacts): OnboardingProgress {
  const steps = onboardingSteps(f);
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;

  return {
    steps,
    done,
    total: required.length,
    complete: done === required.length,
    // Includes optional steps: once the required ones are finished, "invite
    // your team" is a perfectly good next suggestion. It just never blocks
    // the checklist from reporting itself finished.
    next: steps.find((s) => !s.done) ?? null,
  };
}

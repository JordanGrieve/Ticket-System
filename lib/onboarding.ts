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
  | "test_enquiry"
  | "first_reply"
  | "auto_reply"
  | "postal_address"
  | "first_subscriber"
  | "first_newsletter"
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
  /**
   * Somebody here has answered a customer from Postbox.
   *
   * A HUMAN reply, not an auto-acknowledgement: the auto-reply is a setting
   * somebody switched on, and counting it would tick this step for a workspace
   * where no person has ever actually used the product.
   */
  hasSentReply: boolean;
  /** An auto-reply exists AND is switched on. */
  autoReplyEnabled: boolean;
  /** A non-blank postal address is stored. */
  hasPostalAddress: boolean;
  /** At least one confirmed subscriber. */
  hasSubscriber: boolean;
  /**
   * A newsletter actually went out to somebody.
   *
   * Not "a campaign has status sent". That status is written when the send
   * finishes, whatever the outcome, so a campaign every one of whose
   * recipients failed is `sent` too — lib/campaign-health.ts raises exactly
   * that case as `all_recipients_failed`. Ticking this step off a status that
   * can mean "nothing left the building" would tell a bakery they had sent a
   * newsletter on the day nobody received one.
   *
   * So the evidence is per recipient: at least one row handed to the provider
   * and not rejected by it.
   */
  hasSentNewsletter: boolean;
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
      /*
       * ── THE FIRST STEP IS SOMETHING THEY CAN DO IN NINETY SECONDS ──
       *
       * This has been through two wrong versions. It began as "Connect your
       * contact form" — which ticked on ANY ticket arriving, so it put a tick
       * against connecting a form for people who had connected no form. It
       * then became "Get your enquiries arriving here", which was at least
       * true, but is not an instruction: it describes a state and leaves the
       * reader to work out what to do about it, and the honest answer for a
       * brand new workspace was "wait".
       *
       * Every workspace has a working inbound address from the moment it
       * exists. So the first step is not setup at all — it is proof. Email
       * that address from your phone and watch a ticket appear, which takes a
       * minute, needs no snippet, no forwarding, no DNS and nobody else.
       *
       * ── AND IT UNBLOCKS THE NEXT STEP ──
       * "Answer your first enquiry" is the moment the product becomes real,
       * and until now it could not be reached until a customer happened to
       * write in. A test enquiry is something to answer, so the aha moves from
       * "whenever somebody turns up" to "right now".
       *
       * THE EVIDENCE IS UNCHANGED — any ticket at all. That is deliberate:
       * this is the same check as before, so a workspace whose real enquiries
       * are already arriving is not asked to send itself a test it plainly
       * does not need. Only the instruction changed, because the instruction
       * was the part that was not helping.
       *
       * It is also why this REPLACED the old step rather than joining it. Two
       * steps satisfied by one ticket would tick together, and a checklist
       * where one action fills two boxes reads as padding.
       */
      id: "test_enquiry",
      title: "Send yourself a test enquiry",
      detail:
        "Email your Postbox address from your phone and watch it arrive here. Nothing needs setting up first — then add the snippet to your website, or forward your support address, so real ones come the same way.",
      done: f.hasFormTicket || f.hasAnyTicket,
      href: "/settings/install",
      optional: false,
    },
    {
      /*
       * ── THE ONLY STEP HERE THAT IS NOT A CHORE ──
       *
       * Every other item is configuration: put a snippet on a page, fill in an
       * address, switch a thing on. None of them is the product doing anything
       * for anybody. A checklist made entirely of chores is the documented
       * failure shape — the value arrives after the list ends, so the list
       * reads as a tax rather than as progress.
       *
       * This is the moment Postbox becomes real: a customer wrote in and got
       * an answer back, from the shared inbox, as the business. It is also the
       * activation event we should be measuring, which makes it the one item
       * worth putting in front of the configuration rather than behind it.
       */
      id: "first_reply",
      title: "Answer your first enquiry",
      /*
       * The wording changes with the situation, because the same sentence
       * would be wrong in one of them. With no mail yet this is not something
       * to go and do, it is something to expect — telling somebody to answer
       * an enquiry they have not received reads as the product not knowing
       * what state it is in.
       */
      detail: f.hasAnyTicket
        ? "There is mail waiting. Replying from here keeps the whole thread in one place, and your team can see it has been handled."
        : "Nothing has arrived yet. When the first enquiry does, answer it here rather than from your own mailbox — that is the bit that changes.",
      done: f.hasSentReply,
      href: "/inbox",
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
      /*
       * ── OPTIONAL, BECAUSE THE USER CANNOT DO IT ──
       *
       * Every other required step is an action somebody here can take. This
       * one is not: it needs a member of the public to find the form, enter
       * their address, and click a link in their email. A bakery can do
       * everything right — form live, link shared, sitting in their Instagram
       * bio — and this stays unticked for a week because nobody has signed up
       * yet.
       *
       * Which makes it a checklist that cannot be finished, and this file
       * already argues, about plan-gated steps, that such a thing "reads as
       * the product being broken rather than as a plan boundary". That
       * reasoning applies here and was missed because the step LOOKS like an
       * action. The title said "get", which sounds like something you do.
       *
       * It stays in the list, because the first confirmed subscriber genuinely
       * is a milestone worth showing. It is optional so it can never be the
       * reason somebody's setup never finishes, and the title now names the
       * part they control.
       */
      title: "Share your signup link",
      detail:
        "Put the form on your site or post the link. It ticks when the first person confirms their address by email — that confirmation is what makes them a subscriber.",
      done: f.hasSubscriber,
      href: "/settings/install",
      optional: true,
    },
    {
      /*
       * ── THE OTHER HALF OF THE PRODUCT, AND IT WAS NOT ON THE LIST ──
       *
       * Postbox is an inbox AND a newsletter tool, and until now every step
       * here was about the inbox. A workspace could tick everything, be told
       * it was set up, and have never sent a newsletter — which is the one
       * thing the whole newsletter half exists to do, and the thing the pilot
       * client was signed up for.
       *
       * "Share your signup link" is not this step. Collecting an address is
       * setup; sending to it is the product doing something. Two steps, and
       * the second is the one worth reaching.
       *
       * ── OPTIONAL, FOR THE SAME REASON AS THE STEP ABOVE IT ──
       * It cannot be done until a member of the public has confirmed an
       * address, and no amount of doing the right thing makes that happen on
       * any particular day. Required, it would be a checklist that a bakery
       * doing everything correctly still cannot finish — the failure this
       * file already refuses for plan-gated steps and for the subscriber one.
       *
       * The cost of that choice is honest and worth naming: "you're set up"
       * can be true of a workspace that has never sent a newsletter. It says
       * the setup is done, not that the product has been used, and every
       * required step here is something the client alone can complete.
       */
      id: "first_newsletter",
      title: "Send your first newsletter",
      /*
       * Two wordings, because with nobody to send to this is not an
       * instruction — it is the step above it, again. Telling somebody to
       * send a newsletter to an empty list reads as the product not knowing
       * what state it is in, the same objection that split the first-reply
       * wording.
       */
      detail: f.hasSubscriber
        ? "You have someone to write to. Start from the template — it is already filled in, so the job is editing rather than staring at an empty page."
        : "Nothing to do yet: this needs at least one confirmed subscriber. Once somebody has signed up, there is a template waiting with the wording already in it.",
      done: f.hasSentNewsletter,
      href: "/newsletters",
      optional: true,
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
        (s) =>
          s.id !== "postal_address" &&
          s.id !== "first_subscriber" &&
          s.id !== "first_newsletter",
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

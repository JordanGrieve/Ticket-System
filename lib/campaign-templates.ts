import { STARTER_CAMPAIGN_BODY } from "./newsletter";

/**
 * What a new campaign can start from.
 *
 * ── WHY TEMPLATES AT ALL ──
 * Jordan, 11 Sep 2026: "you assign a template for actions, ie, next drop,
 * signup". The signup one became its own feature — see lib/welcome.ts, which
 * sends automatically rather than waiting to be written. What is left is the
 * campaigns somebody sits down to write, and the observation behind
 * STARTER_CAMPAIGN_BODY applies to each of them: a blank field asks a
 * time-poor non-expert to do creative work at the moment they have the least
 * context, and a default turns creation into editing.
 *
 * ── THE BRACKETS ARE DELIBERATE, HERE TOO ──
 * Every slot names the decision the author has to make rather than sounding
 * like finished prose, so nobody sends it unedited by mistake — and
 * `unfilledSlots` plus the composer's readiness checklist catch them if they
 * try. That is the opposite of the welcome email, whose default has no
 * brackets at all because it sends unattended.
 *
 * Pure data. Adding one is an entry in this array and nothing else.
 */

export type CampaignTemplate = {
  key: string;
  /** On the chip. */
  name: string;
  /** One line under the row, for the selected one. */
  description: string;
  /** Empty means "leave the subject alone" — only the blank start does that. */
  subject: string;
  body: string;
};

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    key: "blank",
    name: "From scratch",
    description: "The bare structure, with the merge tags shown in place.",
    subject: "",
    body: STARTER_CAMPAIGN_BODY,
  },
  {
    key: "next_drop",
    name: "Next drop",
    description:
      "Something new has landed and you want people to come and get it.",
    subject: "[What has landed] — this week at {company}",
    body: [
      "Hi {first_name},",
      "",
      "[What has just landed, in one sentence. Name the thing.]",
      "",
      "[When they can get it and how — a date, an opening time, or a link.]",
      "",
      "[Anything they need to know: how long it lasts, how much there is, whether to order ahead.]",
      "",
      "See you soon,",
      "{company}",
    ].join("\n"),
  },
];

export function templateByKey(key: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES.find((t) => t.key === key) ?? null;
}

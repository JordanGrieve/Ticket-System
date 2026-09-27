import { STARTER_CAMPAIGN_BODY, type TemplateKey } from "./newsletter";

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
  /**
   * The layout this preset is written for, or undefined to leave whatever the
   * author has selected alone.
   *
   * Only "Launch" sets one. Its copy is written for the editorial layout —
   * an opening line that becomes a headline, a stacked detail block, no
   * greeting — and handing that body to the plain layout would produce a
   * letter that starts by shouting. The two copy-only presets stay layout
   * agnostic, because their shape works in any of the three.
   */
  templateKey?: TemplateKey;
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
    ].join("\n"),
  },
  /**
   * ── LAUNCH ──
   * Jordan, 27 Sep 2026, sending over a fashion brand's launch email: "this
   * would be a preset we would use." The look is the `editorial` layout in
   * lib/newsletter.ts; this is the copy shaped for it.
   *
   * It reads differently from the other two on purpose, and each difference
   * is a property of that layout rather than a style preference:
   *
   *  - No greeting. The first block is set as the headline, so "Hi
   *    {first_name}," would be rendered in capitals across the middle of the
   *    page. The name goes in the line under it instead, where it still
   *    personalises the message.
   *  - The date and time are their own block, on three lines inside one
   *    paragraph (single newlines, so they stay one centred stack). That is
   *    the one fact a launch email exists to deliver, and it is the fact the
   *    email this came from had rendered at about 2.5:1 on black.
   *  - It expects a hero photograph and a pair of products. Neither is
   *    required — the layout renders without them — but the preset's whole
   *    subject is imagery, so the copy leaves room for it rather than filling
   *    the page with prose.
   */
  {
    key: "launch",
    name: "Launch",
    description:
      "A drop or a launch: one photograph, a headline, and the date it goes live.",
    subject: "[What is launching] is coming",
    templateKey: "editorial",
    body: [
      "[The headline — a few words, no full stop]",
      "",
      "[One sentence on what it is and who it is for, {first_name}.]",
      "",
      "Launching\n[Date]\n[Time]",
      "",
      "[Where to get it — a link, or the shop's opening time.]",
    ].join("\n"),
  },
];

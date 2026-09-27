import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  NO_BRAND,
  PALETTES,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  renderCampaign,
  type TemplateKey,
} from "../lib/newsletter";
import { CAMPAIGN_TEMPLATES } from "../lib/campaign-templates";

/**
 * The editorial layout, and the preset written for it.
 *
 * ── WHERE IT CAME FROM ──
 * Jordan sent a fashion brand's launch email on 27 Sep 2026 — black, full
 * bleed photograph, a letter-spaced headline over a hairline rule, the launch
 * date stacked in the middle — and said "this would be a preset we would
 * use". The layout is `editorial` in lib/newsletter.ts; the copy is the
 * "launch" entry in lib/campaign-templates.ts.
 *
 * ── WHAT IS WORTH GUARDING, AND WHY ──
 * A dark layout in an email is the one change in this renderer that can go
 * wrong invisibly. Every colour in here used to be a literal chosen for
 * white, and an email cannot be corrected after it is sent: black ink on a
 * black canvas is not a bug somebody fixes on Tuesday, it is forty thousand
 * blank messages. So the assertions below are mostly of the form "the light
 * ink is NOT in this document" rather than "the dark ink is".
 *
 * Set EDITORIAL_HARNESS_OUT to write the rendered messages out as files and
 * look at them in a browser, which is the check no assertion here replaces:
 *
 *   EDITORIAL_HARNESS_OUT=$PWD/public/_em npx vitest run tests/campaign-editorial
 */

const OUT = process.env.EDITORIAL_HARNESS_OUT;

const base = {
  recipient: { email: "sample@example.com", name: "Sample Person" },
  workspaceName: "Amoria",
  unsubscribeUrl: "https://postbox.help/u/token",
  sender: {
    workspaceName: "Amoria",
    legalName: "Amoria Ltd",
    postalAddress: "2 Ellismuir Way, Glasgow, G71 5PW",
  },
  brand: NO_BRAND,
};

const LAUNCH_BODY = [
  "When soft gives strong",
  "",
  "From workouts to post-gym matchas, the new collection is made for the way you actually wear it, {first_name}.",
  "",
  "Launching\n29th September\n4pm BST",
].join("\n");

function render(templateKey: TemplateKey, over: Partial<typeof base> = {}) {
  return renderCampaign({
    ...base,
    ...over,
    campaign: {
      subject: "ANISIA is coming",
      preheader: "Launching Monday at 4pm",
      templateKey,
      body: LAUNCH_BODY,
    },
    hero: { url: "https://cdn.example.com/hero.jpg", alt: "The new collection" },
    products: [
      { name: "The ribbed set", price: "£68", imageUrl: "https://cdn.example.com/a.jpg", url: "https://shop.example.com/a" },
      { name: "The long-sleeve", price: "£42", imageUrl: "https://cdn.example.com/b.jpg", url: null },
    ],
  });
}

describe("every layout has a shell of its own", () => {
  it("renders, and paints its own canvas", () => {
    /*
      The failure this exists for is a silent one: a chain of ternaries ending
      in `: plainShell(...)` renders an unknown layout as plain and says
      nothing. renderCampaign uses a Record keyed by TemplateKey so a new key
      does not compile without a shell, and this checks the other half — that
      the shell it got is actually that layout's.
    */
    for (const key of TEMPLATE_KEYS) {
      const html = render(key).html;
      expect(html.length, key).toBeGreaterThan(400);
      expect(html, `${key} does not paint ${PALETTES[key].canvas}`).toContain(
        `background:${PALETTES[key].canvas}`,
      );
    }
  });

  it("gives each one a name and a description for the two screens that offer it", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(TEMPLATE_LABELS[key].name.trim(), key).not.toBe("");
      expect(TEMPLATE_LABELS[key].description.trim(), key).not.toBe("");
    }
  });

  it("the light layouts are unchanged by the palette refactor", () => {
    // The literals that were in the renderer before palettes existed, in the
    // places they were in. Palettes were introduced to add a dark layout, not
    // to restyle the two that are in front of real recipients today.
    for (const key of ["plain", "branded"] as const) {
      const html = render(key).html;
      expect(html, key).toContain("color:#3c372f");
      expect(html, key).toContain("color:#746d61");
      expect(html, key).toContain("background:#ffffff");
    }
  });
});

describe("the editorial layout", () => {
  const html = render("editorial").html;

  it("carries no ink that was chosen for a white page", () => {
    /*
      The assertion that matters. #3c372f body text measures 1.2:1 on this
      canvas — which is not "hard to read", it is a blank message that looks
      exactly like a working one from the sending side.
    */
    for (const lightInk of ["#3c372f", "#746d61", "#57503f", "#26221d"]) {
      expect(html, `${lightInk} is light-layout ink on a black canvas`).not.toContain(
        `color:${lightInk}`,
      );
    }
  });

  it("sets the opening block as the headline, over a rule", () => {
    expect(html).toContain("When soft gives strong");
    // The headline's own signature: letter-spaced, centred, strong ink.
    expect(html).toMatch(
      /letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-align:center;">When soft gives strong/,
    );
    // And the hairline directly under it, before the first paragraph.
    const rule = html.indexOf(`background:${PALETTES.editorial.rule}`);
    expect(rule, "no hairline rule under the headline").toBeGreaterThan(-1);
    expect(rule).toBeLessThan(html.indexOf("From workouts"));
  });

  it("keeps the rest of the body as paragraphs, centred", () => {
    expect(html).toContain("text-align:center;\">From workouts");
    // The launch block's three lines stay one stack, not three paragraphs.
    expect(html).toMatch(/Launching<br \/>29th September<br \/>4pm BST/);
  });

  it("runs the hero to the edges, in its own row above the padded text", () => {
    // Full bleed is the layout. A rounded 496px picture floating on black is
    // the thing it exists not to be.
    expect(html).toMatch(/<img[^>]+hero\.jpg[^>]+width="600"/);
    expect(html).not.toMatch(/<img[^>]+hero\.jpg[^>]+border-radius/);
    // The photograph comes before the text, and the text's padding is on a
    // cell the photograph is not inside.
    expect(html.indexOf("hero.jpg")).toBeLessThan(html.indexOf("When soft"));
    expect(html).toContain("padding:34px 30px 0;");
  });

  it("still ends with the unsubscribe link and the postal address", () => {
    // The two lines a commercial email may not lose to a restyle.
    expect(html).toContain("https://postbox.help/u/token");
    expect(html).toContain("2 Ellismuir Way");
    expect(html).toContain("Unsubscribe");
  });

  it("gives the plain-text part the same words, with no markup", () => {
    const out = render("editorial");
    expect(out.text).toContain("When soft gives strong");
    expect(out.text).toContain("The ribbed set — £68");
    expect(out.text).not.toContain("<");
  });

  it("does not claim a preference centre that does not exist", () => {
    // The email this was modelled on offered "Manage Preferences" beside
    // Unsubscribe. Postbox has no preference centre, and a link to one that
    // does not exist is what RFC 8058 compliance is meant to prevent.
    expect(html).not.toMatch(/manage preferences/i);
  });
});

describe("the Launch preset", () => {
  const launch = CAMPAIGN_TEMPLATES.find((t) => t.key === "launch");

  it("exists and names the layout it was written for", () => {
    expect(launch, "the Launch preset is gone").toBeDefined();
    expect(launch!.templateKey).toBe("editorial");
  });

  it("opens with a headline, not a greeting", () => {
    /*
      The first block becomes the headline in this layout, so "Hi
      {first_name}," would be set in capitals across the middle of the page.
      This is the one property of the copy that the layout dictates.
    */
    const first = launch!.body.split(/\n{2,}/)[0]!;
    expect(first).not.toMatch(/^hi\b/i);
    expect(first).not.toContain("{first_name}");
    expect(first.length).toBeLessThan(60);
  });

  it("keeps the launch details as one stacked block", () => {
    // Single newlines inside one paragraph. Blank lines between them would
    // render as three separate centred paragraphs with 16px between each.
    expect(launch!.body).toMatch(/Launching\n\[Date\]\n\[Time\]/);
  });

  it("renders through the real renderer without losing its slots", () => {
    const out = renderCampaign({
      ...base,
      campaign: {
        subject: launch!.subject,
        preheader: null,
        templateKey: launch!.templateKey!,
        body: launch!.body,
      },
    });
    // The composer's readiness check refuses to send while a [slot] remains;
    // this is only that the renderer passes them through to be caught.
    expect(out.html).toContain("[Date]");
  });
});

describe("the composer applies a preset's layout", () => {
  /*
    A source assertion, because the alternative is mounting the composer with
    a server round trip. The preset's whole subject is a look — if the click
    handler patches only `subject` and `body`, choosing "Launch" gives you
    editorial copy in the plain layout and nothing says so.
  */
  const source = readFileSync(
    join(process.cwd(), "app", "(dashboard)", "newsletters", "Composer.tsx"),
    "utf8",
  );

  it("patches templateKey from the template it was given", () => {
    const start = source.indexOf("setStartedFrom(t.key)");
    expect(start, "the Start from handler has moved").toBeGreaterThan(-1);
    const handler = source.slice(start, start + 700);
    expect(
      handler,
      "the Start from handler no longer applies t.templateKey — a preset " +
        "written for a layout would be applied without it",
    ).toContain("t.templateKey");
  });
});

describe("the harness", () => {
  it("writes each layout out when asked", () => {
    if (!OUT) {
      // Not a skip: the assertion is that the env var is what decides, and a
      // silent skip and a broken writer look identical from the outside.
      expect(OUT).toBeUndefined();
      return;
    }
    mkdirSync(OUT, { recursive: true });
    for (const key of TEMPLATE_KEYS) {
      /*
        Real photographs, only here. The assertions above use example.com
        URLs, which are correct for them — nothing should be fetched to prove
        an `src` is in the markup — but a black layout whose whole subject is
        imagery cannot be judged from three alt texts, and the point of this
        file is to be looked at.
      */
      const html = render(key)
        .html.replace(/https:\/\/cdn\.example\.com\/hero\.jpg/g, "https://picsum.photos/seed/hero/1200/900")
        .replace(/https:\/\/cdn\.example\.com\/a\.jpg/g, "https://picsum.photos/seed/one/600/700")
        .replace(/https:\/\/cdn\.example\.com\/b\.jpg/g, "https://picsum.photos/seed/two/600/700");
      writeFileSync(join(OUT, `${key}.html`), html, "utf8");
    }
  });
});

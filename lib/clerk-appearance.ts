/**
 * How Clerk's hosted sign-in and sign-up cards are painted.
 *
 * ── WHY NOT THE `dark` THEME FROM @clerk/ui ──
 * The card was Clerk's default white, sitting in the middle of a near-black
 * indigo page — a bright rectangle punched into the design, and the first
 * thing anybody signing up sees.
 *
 * The obvious fix is to install @clerk/ui and pass its `dark` theme. That
 * would be wrong here for a reason specific to this product: Postbox has FIVE
 * palettes and one of them is Light. Hardcoding dark would fix the card for
 * four of them and break it for the fifth, which is the same mistake in the
 * other direction.
 *
 * So the values are our own custom properties. Clerk applies these as CSS on
 * its own elements, so `var(--surface)` resolves against whatever theme the
 * document is carrying — the card follows the palette rather than picking a
 * side. It also means no new dependency for what is a dozen colours.
 *
 * If a variable ever fails to resolve, Clerk falls back to its own default,
 * which is the white card we have today. That is worth knowing: the failure
 * mode of this file is "no worse than before", not "unreadable".
 */
export const clerkAppearance = {
  variables: {
    colorBackground: "var(--surface)",
    colorForeground: "var(--text)",
    colorMutedForeground: "var(--muted)",
    colorInput: "var(--surface-2)",
    colorInputForeground: "var(--text)",
    colorBorder: "var(--border)",
    colorPrimary: "var(--accent)",
    colorPrimaryForeground: "#ffffff",
    colorNeutral: "var(--text)",
    // Matches the radius used across the app's own cards and inputs.
    borderRadius: "12px",
  },
  elements: {
    /*
      ── --accent IS A BUTTON COLOUR, NOT A TEXT COLOUR ──
      `colorPrimary` above sets both the primary button's background and the
      colour of Clerk's text links, which are two different jobs. As a
      background under white it is fine; as 13px text on the card it measured
      3.26:1 in the browser — under AA — and against --surface it is 3.05:1 in
      dark and 3.10:1 in ocean.

      This is the same mistake .pbo-go, .pbn-add and .pbt-cta made: --accent is
      the light sibling, meant for borders and focus rings where 1.4.11 asks
      3:1. --accent-text is the token for accent-coloured TEXT, and it measures
      7.11 to 9.94 on the card across all five palettes.

      Only one link element renders on these two screens — cl-footerActionLink,
      the "Sign up" / "Sign in" swap at the foot of the card — confirmed by
      listing every cl-*Link Clerk actually put in the DOM rather than guessing
      from its docs.
    */
    footerActionLink: { color: "var(--accent-text)" },
  },
  options: {
    // Google is the only provider configured, so a full-width block button
    // reads as "this is how you sign in" rather than as one icon among
    // several that are not there.
    socialButtonsVariant: "blockButton",
  },
} as const;

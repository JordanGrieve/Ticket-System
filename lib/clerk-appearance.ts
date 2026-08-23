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
  options: {
    // Google is the only provider configured, so a full-width block button
    // reads as "this is how you sign in" rather than as one icon among
    // several that are not there.
    socialButtonsVariant: "blockButton",
  },
} as const;

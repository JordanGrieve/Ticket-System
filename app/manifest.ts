import type { MetadataRoute } from "next";

/**
 * Web app manifest. Mobile Postbox is a responsive PWA rather than a native
 * app, so this file is what makes the site installable on Android and what
 * Chrome/Edge use for the desktop "install app" prompt. iOS ignores almost
 * all of it (see app/apple-icon.png).
 *
 * No service worker is registered, deliberately — see the note at the bottom.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity for the install, decoupled from start_url. Without an
    // explicit id the browser derives one from start_url, so later moving the
    // launch target would register as a *different* app and users would end up
    // with two icons. Pinning it to "/" means start_url can be changed freely.
    id: "/",

    name: "Postbox",
    // Home-screen labels get truncated around 12 characters, and the product
    // name is already short, so there is nothing to abbreviate.
    short_name: "Postbox",
    description:
      "Turn contact-form submissions and inbound email into a clean, threaded support inbox.",

    // "/" is the marketing landing page. It redirects signed-in users to
    // /inbox, but an installed app should never render the brochure — not even
    // for the frame it takes to bounce. Launching straight at /inbox means a
    // signed-in user lands on their tickets immediately, and a signed-out user
    // is sent to sign-in by Clerk, which is the correct cold-start for an app.
    start_url: "/inbox",

    // Scope stays at the root so sign-in, settings, admin and the legal pages
    // all stay inside the installed window instead of kicking out to a browser
    // tab mid-flow. Clerk's redirect through /sign-in would break otherwise.
    scope: "/",

    display: "standalone",

    // The app is a two-pane inbox that already reflows to a single column; it
    // is usable in either rotation, so there is no reason to lock the user out
    // of landscape on a tablet.
    orientation: "any",

    // A SINGLE static value has to sit under six themes, three of them dark.
    // Picking a light surface (#FFFFFF) gives the dark themes a white title
    // bar; picking a dark surface (#241F3C) gives the light themes a dark one.
    // Either reads as broken. The brand accent is the least-wrong answer: a
    // saturated purple chrome bar reads as deliberate branding against every
    // theme rather than as a mismatched surface.
    //
    // The genuinely correct fix is a media-scoped pair of <meta name="theme-color">
    // tags via a `viewport` export in app/layout.tsx, which the manifest value
    // then only backstops. That file is owned by another agent — see the report.
    theme_color: "#6D4AFF",

    // Paints the Android splash screen behind the icon. Same one-value-six-themes
    // problem, resolved the other way: a dark splash flashing before a light app
    // is far less unpleasant than a full-brightness flash before a dark app, and
    // the purple/white icon has good contrast on it.
    background_color: "#241F3C",

    categories: ["business", "productivity"],
    lang: "en",
    dir: "ltr",

    icons: [
      // "any" — rendered as-is (Chrome install prompt, desktop, older Android).
      // Purple squircle plate so the mark never floats on an unknown wallpaper.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable" — Android applies its own shape mask (often a circle) and
      // crops. These are full-bleed and opaque with the mark held inside the
      // central safe zone, so nothing gets clipped. Not the same art at a
      // different size; separate files with real padding.
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

// Deliberately no service worker. One would add offline support and a nicer
// cold start, but it is a cache that outlives deploys: without a decided
// versioning and update strategy it serves stale JS to users who then report
// bugs nobody can reproduce. Installability does not require one.

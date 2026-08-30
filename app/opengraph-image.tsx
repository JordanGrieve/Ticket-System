import { ImageResponse } from "next/og";

/**
 * The card people see when a link to Postbox is pasted into Slack, WhatsApp,
 * LinkedIn or a group chat.
 *
 * ── WHY GENERATED AND NOT A PNG IN public/ ──
 * A checked-in image is a second copy of the brand that goes stale silently:
 * the product name, the tagline and the palette all change in code, and
 * nothing makes the picture follow. This renders from the same values, so it
 * cannot drift, and there is no binary in the repository to re-export by hand
 * every time a word changes.
 *
 * next/og is part of Next and needs no external service. The image is built
 * once at build time — the route is static, since nothing here varies per
 * request — so it costs nothing at serve time.
 *
 * ── NO WEB FONT ──
 * Deliberately the system stack rather than fetching Plus Jakarta Sans. A
 * font fetch inside an OG route is a network call in the build, which fails
 * differently in CI than locally and takes the whole build with it when the
 * font host has a bad day. A card that renders in a slightly different
 * typeface is a cosmetic difference; a card that fails to build is a deploy.
 *
 * Sizes and weights are inline because ImageResponse implements a small subset
 * of CSS via Satori: no cascade, no stylesheets, and every flex container has
 * to state `display: flex` explicitly.
 */

export const alt =
  "Postbox — support tickets that feel like an inbox";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          // The dark brand ground, matching the manifest's background_color so
          // the card and an installed app's splash screen agree.
          background: "#241F3C",
          color: "#F3F0FF",
          padding: "72px 80px",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 44,
          }}
        >
          {/* The envelope mark, drawn rather than imported: an <img> here would
              need a URL that resolves during the build, which is the same
              fragility the font note above is about. */}
          <div
            style={{
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "#6D4AFF",
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
            Postbox
          </div>
        </div>

        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -2,
            maxWidth: 900,
          }}
        >
          Support tickets that feel like an inbox
        </div>

        <div
          style={{
            fontSize: 30,
            lineHeight: 1.4,
            color: "#A79FD0",
            marginTop: 28,
            maxWidth: 860,
          }}
        >
          Contact-form submissions and inbound email, in one threaded inbox.
          Newsletters with confirmed opt-in.
        </div>
      </div>
    ),
    size,
  );
}

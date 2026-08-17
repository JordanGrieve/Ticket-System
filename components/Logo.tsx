/**
 * Brand mark and lockup.
 *
 * The wordmark is real DOM text rather than <text> inside the SVG, so it picks up
 * the loaded Hanken Grotesk and stays selectable. The standalone .svg files (for
 * decks, email, anywhere outside the app) carry their own wordmark.
 *
 * Colours default to the accent tokens, so the mark recolours with each
 * workspace's scheme. Pass LITERAL_COLORS on any surface that renders without
 * globals.css — app/global-error.tsx is the one that does, since it replaces the
 * root layout that would otherwise have loaded the stylesheet.
 */

export type MarkColors = {
  /** Rear message. */
  rear: string;
  /** Front message. */
  front: string;
  /** Thread lines, knocked out — must match the surface behind the mark. */
  knockout: string;
};

export const TOKEN_COLORS: MarkColors = {
  rear: "var(--accent-strong)",
  front: "var(--accent)",
  knockout: "var(--app-bg)",
};

/**
 * Hardcoded twins of the token values, for surfaces that render without
 * globals.css (global-error.tsx replaces the root layout, so the stylesheet
 * never loads) and for error/loading routes that must paint before anything
 * else is certain.
 *
 * These are the THIRD place the palette is written down, after globals.css and
 * app/icon.svg, and they were missed in the pivot — the error page shipped in
 * terracotta against a purple app for a day. Keep them in step with --accent,
 * --accent-strong and --surface-2 by hand; nothing enforces it.
 */
export const LITERAL_COLORS: MarkColors = {
  rear: "#5636e0",
  front: "#6d4aff",
  knockout: "#1e1a33",
};

export function PostboxMark({
  size = 34,
  colors = TOKEN_COLORS,
  className,
}: {
  size?: number;
  colors?: MarkColors;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill={colors.rear}
        d="M16 10H51C53.21 10 55 11.79 55 14V35C55 37.21 53.21 39 51 39H24L16 47V10Z"
      />
      <path
        fill={colors.front}
        d="M9 19H44C46.21 19 48 20.79 48 23V50C48 52.21 46.21 54 44 54H9C6.79 54 5 52.21 5 50V23C5 20.79 6.79 19 9 19Z"
      />
      <path fill={colors.knockout} d="M13 29H40V33H13Z" />
      <path fill={colors.knockout} d="M13 38H34V42H13Z" />
    </svg>
  );
}

export function PostboxLockup({
  size = 34,
  fontSize = 20,
  colors = TOKEN_COLORS,
  color,
  className,
}: {
  size?: number;
  fontSize?: number;
  colors?: MarkColors;
  /** Wordmark colour. Inherits from the surrounding text when omitted. */
  color?: string;
  className?: string;
}) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
      className={className}
    >
      <PostboxMark size={size} colors={colors} />
      <span style={{ fontSize, fontWeight: 700, letterSpacing: "-0.01em", color }}>
        Postbox
      </span>
    </span>
  );
}

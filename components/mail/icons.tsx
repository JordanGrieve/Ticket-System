/**
 * Line icons from the mailer design.
 *
 * Stroke colour is `currentColor` so the icon inherits from whatever token the
 * surrounding class sets — hardcoding a colour here would break five of the six
 * themes. Every icon is decorative: the accessible name lives on the button or
 * link that wraps it, so they are all aria-hidden.
 */

export const ICON_PATHS = {
  mail: "M3.5 7a3 3 0 013-3h11a3 3 0 013 3v10a3 3 0 01-3 3h-11a3 3 0 01-3-3z M4.5 7.5l6.4 4.2a2 2 0 002.2 0l6.4-4.2",
  lines: "M4 6.5h16M4 12h16M4 17.5h10",
  star: "M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z",
  label: "M4 10.5V5.5a1.5 1.5 0 011.5-1.5h5l9 9-6.5 6.5-9-9z M8 8h.01",
  send: "M3.5 11.8L20 4.5l-7.3 16.5-2.2-6.6-7-2.6z",
  trash: "M4 7h16M9 7V4.8h6V7M6.5 7l1 12.5h9L17.5 7",
  news: "M4 5.5h13v13H5.5A1.5 1.5 0 014 17zM17 9h2.5A1.5 1.5 0 0121 10.5V17a1.5 1.5 0 01-1.5 1.5H17M7 9h7M7 12.5h7M7 15.5h4",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 13.5l1.6 1-2 3.4-1.9-.6a7 7 0 01-1.7 1l-.4 2h-4l-.4-2a7 7 0 01-1.7-1l-1.9.6-2-3.4 1.6-1a7 7 0 010-2l-1.6-1 2-3.4 1.9.6a7 7 0 011.7-1l.4-2h4l.4 2a7 7 0 011.7 1l1.9-.6 2 3.4-1.6 1a7 7 0 010 2z",
  people:
    "M12 12a4 4 0 100-8 4 4 0 000 8z M4.5 20a7.5 7.5 0 0115 0",
  search: "M16 16l4 4",
  check: "M5 12.5l4.5 4.5L19 7",
  clip: "M20 12.5l-7.6 7.6a4.5 4.5 0 01-6.4-6.4l8-8a3 3 0 014.3 4.3l-8 8a1.5 1.5 0 01-2.1-2.1l7.3-7.3",
  back: "M14.5 5l-7 7 7 7",
  chevronDown: "M7 10l5 5 5-5",
  close: "M5 5l14 14M19 5L5 19",
  plus: "M12 5v14M5 12h14",
  /** "Mark unread" — an envelope with its flap still up. */
  envelopeOpen:
    "M3.5 10.5L12 4.5l8.5 6v7a2.5 2.5 0 01-2.5 2.5H6a2.5 2.5 0 01-2.5-2.5z M3.5 10.5l7.4 4.9a2 2 0 002.2 0l7.4-4.9",
  pencil: "M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.9,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /**
   * Fill the shape with currentColor as well as stroking it. Used for the
   * "on" state of a toggle (a starred thread), where an outline alone reads
   * as off at 17px.
   */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      aria-hidden
      focusable="false"
      className={className}
    >
      <path
        d={ICON_PATHS[name]}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The magnifier needs a circle as well as a path. */
export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth={2} />
      <path
        d={ICON_PATHS.search}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Vertical ellipsis — filled dots rather than a stroked path. */
export function OverflowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

/** The Postbox envelope used in the nav brand block. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="4"
        stroke="currentColor"
        strokeWidth={2}
      />
      <path
        d="M4 8.5l7.1 4.6a1.7 1.7 0 001.8 0L20 8.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

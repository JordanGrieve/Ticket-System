import type { CSSProperties } from "react";
import type { LabelColor } from "@/db/schema";

/**
 * The attributes that paint one label, in one place.
 *
 * There are six render sites — the manager, the picker's chosen list and its
 * menu, the nav's label rows, the message-list cards and the thread. Six
 * copies of "spread the hex into a custom property if there is one, otherwise
 * fall back to the token" is six chances for one of them to keep showing the
 * old colour after somebody changes it, and the one that drifts is always the
 * one nobody looks at.
 *
 * ── WHY A CUSTOM PROPERTY AND NOT A DIRECT background ──
 * The chip needs the chosen colour mixed into the THEME's surface and ink, not
 * painted flat — see the data-custom rules in mail.css. Setting background
 * inline would win over that and hand back the readability problem the mixing
 * exists to solve. Passing the hue in as a variable lets the stylesheet keep
 * ownership of the contrast.
 */
export function labelChipProps(label: {
  color: LabelColor;
  colorHex?: string | null;
}): {
  "data-color": LabelColor;
  "data-custom"?: true;
  style?: CSSProperties;
} {
  if (!label.colorHex) return { "data-color": label.color };
  return {
    // data-color is still set, so a chip whose hex fails to parse in some
    // future browser falls back to a token that always renders.
    "data-color": label.color,
    "data-custom": true,
    style: { "--label-hex": label.colorHex } as CSSProperties,
  };
}

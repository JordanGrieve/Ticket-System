"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps `--pbt-h` equal to the banner's real height.
 *
 * ── WHY THIS IS NOT A CONSTANT ──
 * The shell is height:100dvh with overflow:hidden, so a banner above it has to
 * buy its own space back through padding on .pb-shell. The impersonation
 * banner does that with a hardcoded 46px, which works because its text is one
 * short line that never wraps.
 *
 * This banner's text does wrap, and how much depends on the tone and the
 * width: the short countdown is one line on a wide screen and two on a narrow
 * one, and the "subscription lapsed" message plus its reassurance line runs to
 * three or four in a sidebar-width viewport. Measured on a 384px viewport the
 * same element was 46px, 84px and 152px in different states. Any single number
 * written into the stylesheet is therefore wrong most of the time, and wrong in
 * the direction that matters — too small means the banner covers the top of
 * the inbox, which is where the unread count and the first ticket live.
 *
 * So the number is measured rather than guessed. A ResizeObserver writes the
 * observed height onto :root, where both the banner and .pb-shell can read it,
 * and it stays correct through wrapping, font scaling and tone changes.
 *
 * The 46px in the stylesheet remains as the pre-hydration default — it is what
 * the server paints with, and being briefly a little short is invisible next to
 * the layout shift of starting at zero.
 *
 * Cleanup sets the property back to the default rather than removing it, so a
 * dismissed banner does not leave the shell padded for a bar that is gone.
 */
export default function TrialBannerMeasure() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const slot = ref.current?.parentElement;
    if (!slot) return;

    const root = document.documentElement;
    const apply = () => {
      const h = Math.ceil(slot.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty("--pbt-h", `${h}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slot);

    return () => {
      ro.disconnect();
      root.style.removeProperty("--pbt-h");
    };
  }, []);

  // Nothing visible: this exists only to find its parent and measure it.
  return <span ref={ref} hidden aria-hidden />;
}

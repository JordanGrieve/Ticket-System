"use client";

import { useEffect } from "react";
import { themeAttr } from "@/lib/theme";

/**
 * Applies the workspace's stored theme to the document root.
 *
 * The token blocks in globals.css key off `data-theme` on `:root`, but `<html>`
 * is rendered by the root layout, which has no workspace context — so the
 * attribute is set from the client once the layout that DOES know the workspace
 * has mounted.
 *
 * Always light or dark — themeAttr never returns nothing, so the attribute is
 * always written. Before 9 Sep 2026 "system" cleared it and left the device to
 * decide; that option is gone.
 *
 * Known limitation: until this runs the document follows prefers-color-scheme,
 * so a light workspace on a dark device gets one frame of dark. Fixing that
 * properly means resolving the theme server-side in the root layout — worth
 * doing when the dashboard is rebuilt, since it needs a cookie or a
 * route-group layout that can read the workspace.
 */
export function ThemeApplier({ theme }: { theme: string | null | undefined }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeAttr(theme));
  }, [theme]);

  return null;
}

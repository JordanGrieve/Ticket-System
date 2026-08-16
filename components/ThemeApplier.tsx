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
 * "system" resolves to no attribute at all, which is what lets the
 * prefers-color-scheme block in globals.css take over. That is why this clears
 * the attribute rather than writing "system" into it.
 *
 * Known limitation: on a non-default theme there is one frame of light palette
 * before this runs. Fixing that properly means resolving the theme server-side
 * in the root layout — worth doing when the dashboard is rebuilt, since it needs
 * a cookie or a route-group layout that can read the workspace.
 */
export function ThemeApplier({ theme }: { theme: string | null | undefined }) {
  useEffect(() => {
    const attr = themeAttr(theme);
    const root = document.documentElement;
    if (attr) root.setAttribute("data-theme", attr);
    else root.removeAttribute("data-theme");
  }, [theme]);

  return null;
}

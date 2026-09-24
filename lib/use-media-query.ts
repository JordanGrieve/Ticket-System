import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept live as the viewport changes.
 *
 * The server has no viewport, so it — and the hydrating render — answer
 * `false`, and the real answer arrives in the render straight after. Layout
 * must never depend on this; it is for behaviour that has to know which of
 * two layouts CSS chose (is the nav a column or a drawer?), and CSS still
 * decides the layout on its own.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

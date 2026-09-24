import { useEffect, useEffectEvent, type RefObject } from "react";

/**
 * Close something while it is open: on Escape always, and — when `inside` is
 * given — on a pointerdown anywhere outside that element.
 *
 * `onDismiss` is read through useEffectEvent, so an inline arrow does not
 * re-subscribe the listeners on every render; only `open` does.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  inside?: RefObject<HTMLElement | null>,
): void {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const onPointer = (e: PointerEvent) => {
      if (inside && !inside.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener("keydown", onKey);
    if (inside) document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (inside) document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, inside]);
}

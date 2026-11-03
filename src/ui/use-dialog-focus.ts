import { useRef } from "react";

/** Controlled dialogs have no Radix Trigger to restore focus automatically. */
export function useDialogFocus(
  fallback = '.calendar-tools [aria-label="Create event"]',
) {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      returnTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = returnTo.current?.isConnected
        ? returnTo.current
        : document.querySelector<HTMLElement>(fallback);
      target?.focus({ preventScroll: true });
    },
  };
}

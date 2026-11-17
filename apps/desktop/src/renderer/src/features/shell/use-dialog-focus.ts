import { useRef } from "react";

/** Controlled root dialogs have no DialogTrigger for Radix to restore focus to. */
export function useDialogFocus() {
  const previous = useRef<HTMLElement | null>(null);
  return {
    captureFocus() {
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    restoreFocus(event: Event) {
      event.preventDefault();
      const target = previous.current;
      const closingOverlay = target?.closest('[data-slot="dialog-content"][data-state="closed"], [data-slot="alert-dialog-content"][data-state="closed"], [data-slot="dropdown-menu-content"][data-state="closed"], [data-slot="context-menu-content"][data-state="closed"]');
      if (target?.isConnected && !closingOverlay) target.focus();
      else (document.querySelector<HTMLElement>('button[aria-current="page"]') ?? document.querySelector<HTMLElement>('[data-sidebar="trigger"]'))?.focus();
    },
  };
}

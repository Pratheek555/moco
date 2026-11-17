import type { ReactNode } from "react";
import { cn } from "cn";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

/**
 * The strip across the top of the main panel. It drags the window, holds the sidebar toggle,
 * and keeps content clear of the system window buttons (right on Windows, left on macOS when
 * the sidebar is collapsed). Buttons, links and inputs inside stay clickable automatically.
 */
export function TopBar({ children, className }: { children?: ReactNode; className?: string }) {
  const { state } = useSidebar();
  return (
    <header
      data-sidebar-state={state}
      className={cn(
        "app-region-drag flex h-12 shrink-0 items-center gap-2 border-b bg-background pl-3 pr-[calc(var(--window-controls-width)+0.75rem)]",
        "data-[sidebar-state=collapsed]:pl-[calc(var(--traffic-lights-width)+0.75rem)]",
        className,
      )}
    >
      <SidebarTrigger className="text-muted-foreground" aria-label="Toggle sidebar" />
      {children}
    </header>
  );
}

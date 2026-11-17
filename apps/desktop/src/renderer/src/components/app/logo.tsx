import { cn } from "cn";

/** The Moco mark: three leaning bars, as on the app icon. Coloured by the text colour (brand blue by default). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 text-primary", className)} fill="currentColor">
      <rect x="2.5" y="6.9" width="4.7" height="15.9" rx="2.35" transform="rotate(-12 4.85 14.85)" />
      <rect x="9.35" y="1.25" width="4.7" height="20.1" rx="2.35" transform="rotate(-12 11.7 11.3)" />
      <rect x="17.3" y="7.3" width="4.7" height="12.4" rx="2.35" transform="rotate(-12 19.65 13.5)" />
    </svg>
  );
}

/** Mark and wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-semibold tracking-tight", className)}>
      <LogoMark />
      moco
    </span>
  );
}

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useApp } from "@/lib/store.ts"

const Toaster = ({ ...props }: ToasterProps) => {
  // The app tracks its own theme (Settings → appearance), so no next-themes.
  const dark = useApp((s) => s.dark)

  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-destructive" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          // Icon sits on the title's first line; the action stays centred.
          toast: "items-start! gap-3! p-4! shadow-lg! select-text",
          icon: "mt-0.5!",
          content: "gap-1! min-w-0!",
          title: "line-clamp-2 break-words text-sm! font-medium! leading-snug!",
          description: "line-clamp-3 break-words text-sm! leading-normal! text-muted-foreground!",
          actionButton: "self-center! h-7! px-3! rounded-md! text-xs! font-medium!",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--width": "380px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

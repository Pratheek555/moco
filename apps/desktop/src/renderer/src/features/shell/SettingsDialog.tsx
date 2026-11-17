import { useState } from "react";
import { FolderOpen, Info, Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "cn";
import type { Theme } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { useApp, type SettingsSection } from "../../state/app-context.ts";
import { providers } from "../../state/use-app-state.ts";
import { LogoMark } from "../../components/app/logo.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Kbd } from "../../components/ui/kbd.tsx";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { DialogDismiss } from "./DialogDismiss.tsx";
import { ProviderCard } from "./ProviderSetup.tsx";
import { useDialogFocus } from "./use-dialog-focus.ts";
import { NarrationSettings } from "./NarrationSettings.tsx";

const sections: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "General" }, { id: "providers", label: "AI" }, { id: "narration", label: "Narration" }, { id: "storage", label: "Storage" }, { id: "about", label: "About" },
];
const appearances = [{ value: "system", label: "System", icon: Monitor }, { value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }] as const;

export function SettingsDialog({ open, onOpenChange, section, onSectionChange }: {
  open: boolean; onOpenChange(open: boolean): void; section: SettingsSection; onSectionChange(section: SettingsSection): void;
}) {
  const { info, setTheme, setNotifications } = useApp();
  const focus = useDialogFocus();
  const [savingNotifications, setSavingNotifications] = useState(false);
  const modifier = info?.platform === "darwin" ? "⌘" : "Ctrl";
  const shortcuts = [
    ["New project", `${modifier}+N`], ["Command palette", `${modifier}+K`], ["Settings", `${modifier}+,`],
    ["Toggle sidebar", `${modifier}+B`], ["Toggle files", `${modifier}+.`], ["Send message", "Enter"], ["New line", "Shift+Enter"], ["Close overlay", "Esc"],
  ];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-3xl" onOpenAutoFocus={focus.captureFocus} onCloseAutoFocus={focus.restoreFocus}>
      <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14 text-left">
        <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
        <DialogDescription className="sr-only">Appearance, AI connections and project storage.</DialogDescription>
      </DialogHeader>
      <DialogDismiss />
      <div className="flex h-[520px] min-h-0 flex-col sm:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-sidebar p-3 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
          {sections.map(item => <Button key={item.id} variant="ghost" aria-current={section === item.id ? "page" : undefined} onClick={() => onSectionChange(item.id)} className={cn("justify-start", section === item.id && "bg-sidebar-accent text-sidebar-accent-foreground")}>{item.label}</Button>)}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6" key={section}>
          <section aria-labelledby="settings-section-title" className="min-w-0 space-y-6">
            <h2 id="settings-section-title" className="text-base font-semibold">{sections.find(item => item.id === section)?.label}</h2>
            {section === "general" && <>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Appearance</h3>
                {info ? <RadioGroup aria-label="Appearance" value={info.theme} onValueChange={value => void run(() => setTheme(value as Theme))} className="grid-cols-3 gap-2">
                  {appearances.map(({ value, label, icon: Icon }) => <label key={value} htmlFor={`appearance-${value}`} className="flex min-w-0 cursor-pointer flex-col items-center gap-3 rounded-xl border bg-card p-3 transition-colors duration-150 hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="flex items-center gap-2"><RadioGroupItem id={`appearance-${value}`} value={value} aria-label={label} />{label}</span>
                  </label>)}
                </RadioGroup> : <Skeleton className="h-24 w-full" />}
              </div>
              <div className="space-y-3 border-t pt-6">
                <h3 className="text-sm font-medium">Notifications</h3>
                <div className="flex items-start justify-between gap-6">
                  <label htmlFor="notifications" className="cursor-pointer text-[13px] leading-6">Notify me when a project finishes or needs an answer</label>
                  <Switch id="notifications" className="mt-1" checked={info?.notifications ?? true} disabled={!info || savingNotifications} onCheckedChange={enabled => {
                    setSavingNotifications(true); void run(() => setNotifications(enabled)).finally(() => setSavingNotifications(false));
                  }} />
                </div>
              </div>
            </>}
            {section === "providers" && <div className="space-y-4">{providers.map(provider => <ProviderCard key={provider} provider={provider} />)}</div>}
            {section === "narration" && <NarrationSettings />}
            {section === "storage" && <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">Project folders are saved in</p>
              {info ? <p className="select-text break-all rounded-md border bg-muted p-3 font-mono text-xs leading-6">{info.projectsDir}</p> : <Skeleton className="h-16 w-full" />}
              <Button variant="outline" disabled={!info} onClick={() => void run(() => api.openProjectsFolder())}><FolderOpen className="size-4" />Open folder</Button>
            </div>}
            {section === "about" && <>
              <div className="flex items-center gap-4"><LogoMark className="size-12" /><div><p className="text-base font-semibold">Moco</p><p className="mt-1 select-text text-[13px] text-muted-foreground">Version {info?.version ?? "…"}</p></div></div>
              <div className="space-y-4 border-t pt-6">
                <h3 className="flex items-center gap-2 font-medium"><Keyboard className="size-4 text-muted-foreground" />Keyboard shortcuts</h3>
                <dl className="space-y-3">{shortcuts.map(([label, shortcut]) => <div key={label} className="flex items-center justify-between gap-4"><dt className="text-[13px]">{label}</dt><dd><Kbd>{shortcut}</Kbd></dd></div>)}</dl>
              </div>
              <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" />Moco uses your own AI subscription.</p>
            </>}
          </section>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

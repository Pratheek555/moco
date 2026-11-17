import { useEffect, useRef } from "react";
import { Folder, Home, Layers, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import { run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "../../components/ui/command.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { useDialogFocus } from "./use-dialog-focus.ts";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { info, loaded, projects, navigate, openNewProject, openSettings, setTheme } = useApp();
  const modifier = info?.platform === "darwin" ? "⌘" : "Ctrl";
  const focus = useDialogFocus();
  const acted = useRef(false);
  useEffect(() => { if (open) acted.current = false; }, [open]);
  const choose = (action: () => void, transferFocus = false) => { acted.current = transferFocus; onOpenChange(false); action(); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="overflow-hidden rounded-2xl p-0 sm:max-w-xl" showCloseButton={false} onOpenAutoFocus={focus.captureFocus} onCloseAutoFocus={event => { if (acted.current) event.preventDefault(); else focus.restoreFocus(event); }}>
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <DialogDescription className="sr-only">Find a project or choose an action.</DialogDescription>
      <Command className="rounded-2xl">
        <CommandInput aria-label="Search commands and projects" placeholder="Search commands and projects…" className="h-12" />
        <CommandList className="max-h-[min(60vh,420px)] p-2">
          <CommandEmpty>No matching commands or projects.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => choose(openNewProject, true)}><Plus />New project<CommandShortcut>{modifier}+N</CommandShortcut></CommandItem>
            <CommandItem onSelect={() => choose(() => navigate({ name: "home" }), true)}><Home />Go to Home</CommandItem>
            <CommandItem onSelect={() => choose(() => navigate({ name: "skills" }), true)}><Layers />Go to Skills</CommandItem>
            <CommandItem onSelect={() => choose(() => openSettings(), true)}><Settings />Settings<CommandShortcut>{modifier}+,</CommandShortcut></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Appearance">
            <CommandItem disabled={!info} onSelect={() => choose(() => { void run(() => setTheme("system")); })}><Monitor />Use system appearance</CommandItem>
            <CommandItem disabled={!info} onSelect={() => choose(() => { void run(() => setTheme("light")); })}><Sun />Switch to light theme</CommandItem>
            <CommandItem disabled={!info} onSelect={() => choose(() => { void run(() => setTheme("dark")); })}><Moon />Switch to dark theme</CommandItem>
          </CommandGroup>
          {loaded && projects.length > 0 && <><CommandSeparator /><CommandGroup heading="Projects">
            {projects.map(project => <CommandItem key={project.id} value={`project ${project.id} ${project.name}`} keywords={[project.name, project.skill.name]} onSelect={() => choose(() => navigate({ name: "project", id: project.id }), true)}><Folder /><span className="min-w-0 truncate">{project.name}</span></CommandItem>)}
          </CommandGroup></>}
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>;
}

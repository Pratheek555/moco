import { useState } from "react";
import { AppContext } from "./state/app-context.ts";
import { useAppState } from "./state/use-app-state.ts";
import { readPreference, savePreference } from "./state/preferences.ts";
import { SidebarProvider } from "./components/ui/sidebar.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { TopBar } from "./components/app/top-bar.tsx";
import { Button } from "./components/ui/button.tsx";
import { Spinner } from "./components/ui/spinner.tsx";
import { AppSidebar } from "./features/shell/AppSidebar.tsx";
import { ScreenBoundary } from "./features/shell/ScreenBoundary.tsx";
import { CommandPalette } from "./features/shell/CommandPalette.tsx";
import { SettingsDialog } from "./features/shell/SettingsDialog.tsx";
import { DeleteProjectDialog, RenameProjectDialog } from "./features/shell/ProjectDialogs.tsx";
import { Home } from "./features/home/Home.tsx";
import { SkillsPage } from "./features/home/SkillsPage.tsx";
import { NewProjectDialog } from "./features/home/NewProjectDialog.tsx";
import { ProjectScreen } from "./features/project/ProjectScreen.tsx";

export function App() {
  const state = useAppState();
  const { app } = state;
  const [sidebarOpen, setSidebarOpen] = useState(() => readPreference("sidebar") !== "closed");
  const screenKey = app.route.name === "project" ? app.route.id : app.route.name;
  return <AppContext.Provider value={app}>
    <TooltipProvider delayDuration={300}>
      <SidebarProvider open={sidebarOpen} onOpenChange={open => {
        setSidebarOpen(open); savePreference("sidebar", open ? "open" : "closed");
      }} className="h-full min-h-0 overflow-hidden">
        <AppSidebar />
        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <ScreenBoundary key={screenKey}>
            {state.loadError ? <>
              <TopBar><span className="text-sm font-medium">Moco</span></TopBar>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                <p className="font-medium">Moco couldn’t load your library.</p>
                <p role="alert" className="max-w-md select-text break-words text-[13px] text-muted-foreground">{state.loadError}</p>
                <Button variant="outline" disabled={state.loading} onClick={state.retryLoad}>{state.loading && <Spinner />}Try again</Button>
              </div>
            </> : app.loaded && app.route.name === "project" ? <ProjectScreen key={app.route.id} projectId={app.route.id} />
              : app.route.name === "skills" ? <SkillsPage /> : <Home />}
          </ScreenBoundary>
        </main>
      </SidebarProvider>
      <NewProjectDialog open={state.newProjectOpen} onOpenChange={state.setNewProjectOpen} />
      <SettingsDialog open={state.settingsOpen} onOpenChange={state.setSettingsOpen} section={state.settingsSection} onSectionChange={state.setSettingsSection} />
      <CommandPalette open={state.paletteOpen} onOpenChange={state.setPaletteOpen} />
      <RenameProjectDialog project={state.renameProject} onClose={() => state.requestRename(null)} />
      <DeleteProjectDialog project={state.deleteProject} onClose={() => state.requestDelete(null)} />
      <Toaster position="bottom-right" theme={app.info?.theme ?? "system"} />
    </TooltipProvider>
  </AppContext.Provider>;
}

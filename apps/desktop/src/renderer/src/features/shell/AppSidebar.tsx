import { useState } from "react";
import { CircleAlert, Home, Layers, Plus, Search, Settings } from "lucide-react";
import { providerLabels } from "../../../../shared/api.ts";
import { useApp } from "../../state/app-context.ts";
import { providers } from "../../state/use-app-state.ts";
import { Logo } from "../../components/app/logo.tsx";
import { RunStateDot, runStateLabels } from "../../components/app/run-state.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Kbd } from "../../components/ui/kbd.tsx";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, useSidebar } from "../../components/ui/sidebar.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { ProjectContextMenu, ProjectRowMenu } from "./ProjectMenus.tsx";

export function AppSidebar() {
  const { info, loaded, projects, statuses, runStates, attention, route, navigate, openNewProject, openSettings } = useApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const [filter, setFilter] = useState("");
  const shown = projects.filter(project => project.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  return <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
    <SidebarHeader className="shrink-0 gap-4 p-4">
      <div className={`app-region-drag -mx-4 -mt-4 flex min-h-12 items-center px-5 pb-1 ${info?.platform === "darwin" ? "pt-10" : "pt-3"}`}><Logo /></div>
      <Button variant="outline" className="group/new w-full justify-start" onClick={() => { closeMobile(); openNewProject(); }}>
        <Plus className="size-4" /><span>New project</span>
        <Kbd aria-hidden="true" className="ml-auto opacity-0 transition-opacity duration-150 group-hover/new:opacity-100 group-focus-visible/new:opacity-100">{info?.platform === "darwin" ? "⌘" : "Ctrl"}+N</Kbd>
      </Button>
      <SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton isActive={route.name === "home"} aria-current={route.name === "home" ? "page" : undefined} onClick={() => { navigate({ name: "home" }); closeMobile(); }}><Home /><span>Home</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton isActive={route.name === "skills"} aria-current={route.name === "skills" ? "page" : undefined} onClick={() => { navigate({ name: "skills" }); closeMobile(); }}><Layers /><span>Skills</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent className="gap-0 px-2 pb-4">
      <SidebarGroup className="pt-0">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        {loaded && projects.length > 8 && <div className="relative mb-3 mt-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <SidebarInput aria-label="Filter projects" placeholder="Filter projects" value={filter} onChange={event => setFilter(event.target.value)} className="pl-8" />
        </div>}
        <nav aria-label="Projects" className="min-w-0">
          <SidebarMenu>
            {!loaded ? Array.from({ length: 6 }, (_, index) => <SidebarMenuItem key={index}><SidebarMenuSkeleton /></SidebarMenuItem>)
              : shown.map(project => {
                const state = runStates[project.id] ?? "idle";
                const unseen = attention[project.id];
                const label = state !== "idle" ? runStateLabels[state] : unseen === "done" ? "Ready · Unseen" : unseen ? "Unseen update" : "Ready";
                return <ProjectContextMenu key={project.id} project={project}>
                  <SidebarMenuItem className="min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton className="pr-9" aria-label={`${project.name}, ${label}`} isActive={route.name === "project" && route.id === project.id} aria-current={route.name === "project" && route.id === project.id ? "page" : undefined} onClick={() => { navigate({ name: "project", id: project.id }); closeMobile(); }}>
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          {state !== "idle" ? <RunStateDot state={state} /> : unseen ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-72 break-words">{project.name}<span className="mt-1 block opacity-80">{label}</span></TooltipContent>
                    </Tooltip>
                    <ProjectRowMenu project={project} />
                  </SidebarMenuItem>
                </ProjectContextMenu>;
              })}
          </SidebarMenu>
          {loaded && !shown.length && <p className="px-2 py-3 text-[13px] text-muted-foreground">{projects.length ? "No matching projects." : "No projects yet."}</p>}
        </nav>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="shrink-0 border-t border-sidebar-border p-4">
      {providers.filter(provider => statuses[provider] && !statuses[provider]?.ok).map(provider => <Button key={provider} variant="ghost" className="h-auto min-h-8 w-full justify-start whitespace-normal px-2 py-2 text-left text-[13px]" onClick={() => { closeMobile(); openSettings("providers"); }}>
        <CircleAlert className="size-4 text-warning" />
        <span className="min-w-0 break-words">{providerLabels[provider]} {statuses[provider]?.issue === "signed-out" ? "is signed out" : statuses[provider]?.issue === "not-installed" ? "is not installed" : "can’t connect"}</span>
      </Button>)}
      <Button variant="ghost" className="w-full justify-start px-2 text-muted-foreground" onClick={() => { closeMobile(); openSettings(); }}><Settings className="size-4" />Settings</Button>
    </SidebarFooter>
  </Sidebar>;
}

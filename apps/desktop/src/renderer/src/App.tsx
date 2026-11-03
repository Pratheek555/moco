import { Component, Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  ClapperboardIcon,
  FilmIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  ShapesIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import { bootstrap, newSeries, report, runningSeries, useApp, type Route } from "@/lib/store.ts";
import { MOD_KEY } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageError, PageLoading } from "./components/Page.tsx";
import { Studio, LibraryPage } from "./routes/Studio.tsx";
import { SeriesPage } from "./routes/Series.tsx";
import { EpisodePage } from "./routes/Episode.tsx";
import { KitPage } from "./routes/Kit.tsx";
import { TemplatesPage } from "./routes/Templates.tsx";
import { QueuePage } from "./routes/Queue.tsx";
import { SettingsPage } from "./routes/Settings.tsx";
import { UsagePage } from "./routes/Usage.tsx";

const NAV = [
  { name: "studio", label: "Studio", icon: SparklesIcon },
  { name: "library", label: "My series", icon: LibraryIcon },
  { name: "templates", label: "Templates", icon: LayoutTemplateIcon },
  { name: "kit", label: "Creative kit", icon: ShapesIcon },
  { name: "renders", label: "Activity", icon: ClapperboardIcon },
] as const;

// Pages in the sidebar footer, below the workspace.
const FOOTER_NAV = [
  { name: "settings", label: "Settings", icon: Settings2Icon },
  { name: "usage", label: "Usage", icon: ChartColumnIcon },
] as const;

let boot: Promise<void> | undefined;
const SIDEBAR_KEY = "moco.sidebar";

function toggleTheme() {
  void useApp
    .getState()
    .updateSettings({ theme: useApp.getState().dark ? "light" : "dark" })
    .catch(report);
}

class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <PageError
        title="Something interrupted the studio"
        detail={this.state.error}
        action={{ label: "Reload studio", run: () => location.reload() }}
      />
    ) : (
      this.props.children
    );
  }
}

export function App() {
  const route = useApp((s) => s.route),
    settings = useApp((s) => s.settings),
    library = useApp((s) => s.library);
  const [error, setError] = useState(""),
    [help, setHelp] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "collapsed");
  useEffect(() => {
    boot ??= bootstrap();
    boot.catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        useApp.getState().setPalette(!useApp.getState().palette);
      }
      if (key === "n") {
        e.preventDefault();
        newSeries();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={(open) => {
          setSidebarOpen(open);
          localStorage.setItem(SIDEBAR_KEY, open ? "expanded" : "collapsed");
        }}
        className="h-svh overflow-hidden pt-9"
        style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
      >
        {/* The window's title bar is hidden: this strip drags the window and holds the OS window buttons. */}
        <div aria-hidden className="app-region-drag fixed inset-x-0 top-0 z-20 h-11" />
        <AppSidebar busy={runningSeries(library).length} />
        <SidebarInset className="min-h-0 overflow-hidden border">
          <Topbar onHelp={() => setHelp(true)} />
          <div
            className={cn(
              "min-h-0 flex-1",
              route.name === "episode" ? "flex flex-col overflow-hidden" : "overflow-y-auto",
            )}
          >
            {error ? (
              <PageError
                title="Couldn’t open your workspace"
                detail={error}
                action={{ label: "Try again", run: () => location.reload() }}
              />
            ) : !settings ? (
              <PageLoading label="Opening your workspace…" />
            ) : (
              <Boundary key={route.name}>
                {route.name === "studio" ? (
                  <Studio />
                ) : route.name === "library" ? (
                  <LibraryPage />
                ) : route.name === "series" ? (
                  <SeriesPage key={route.id} id={route.id} />
                ) : route.name === "episode" ? (
                  <EpisodePage
                    key={`${route.seriesId}-${route.episodeId}`}
                    seriesId={route.seriesId}
                    episodeId={route.episodeId}
                  />
                ) : route.name === "templates" ? (
                  <TemplatesPage id={route.id} />
                ) : route.name === "kit" ? (
                  <KitPage />
                ) : route.name === "renders" ? (
                  <QueuePage />
                ) : route.name === "usage" ? (
                  <UsagePage />
                ) : (
                  <SettingsPage />
                )}
              </Boundary>
            )}
          </div>
        </SidebarInset>
        <Palette onHelp={() => setHelp(true)} />
        <HelpDialog open={help} onOpenChange={setHelp} />
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AppSidebar({ busy }: { busy: number }) {
  const route = useApp((s) => s.route),
    go = useApp((s) => s.go);
  const active = (name: string) =>
    route.name === name || (name === "library" && (route.name === "series" || route.name === "episode"));
  return (
    <Sidebar variant="inset" collapsible="icon" className="top-9 h-[calc(100svh-2.25rem)]">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Moco studio" onClick={() => go({ name: "studio" })}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <BrandMark />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">Moco</span>
                <span className="truncate text-xs text-muted-foreground">Animation studio</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton variant="outline" tooltip="New series" onClick={newSeries}>
                <PlusIcon />
                <span>New series</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>
                <Shortcut keys={[MOD_KEY, "N"]} />
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton
                    isActive={active(item.name)}
                    tooltip={item.label}
                    onClick={() => go({ name: item.name } as Route)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.name === "renders" && busy > 0 && (
                    <SidebarMenuBadge aria-label={`${busy} in progress`}>{busy}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Search" onClick={() => useApp.getState().setPalette(true)}>
              <SearchIcon />
              <span>Search</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>
              <Shortcut keys={[MOD_KEY, "K"]} />
            </SidebarMenuBadge>
          </SidebarMenuItem>
          {FOOTER_NAV.map((item) => (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton
                isActive={route.name === item.name}
                tooltip={item.label}
                onClick={() => go({ name: item.name })}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// Three bars of a clapper, tilted: the Moco mark.
function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 -rotate-12" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="5" width="4.5" height="14" rx="2" />
      <rect x="9.75" y="2" width="4.5" height="20" rx="2" />
      <rect x="16" y="7" width="4.5" height="10" rx="2" />
    </svg>
  );
}

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

function Topbar({ onHelp }: { onHelp(): void }) {
  const canGoBack = useApp((s) => s.history.length > 0),
    dark = useApp((s) => s.dark),
    busy = runningSeries(useApp((s) => s.library)).length,
    go = useApp((s) => s.go);
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="-ml-1" />
        </TooltipTrigger>
        <TooltipContent>
          Toggle sidebar <Shortcut keys={[MOD_KEY, "B"]} />
        </TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      {canGoBack && (
        <IconButton label="Back" onClick={() => useApp.getState().back()}>
          <ArrowLeftIcon />
        </IconButton>
      )}
      <Crumbs />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {busy > 0 && (
          <Button variant="ghost" size="sm" onClick={() => go({ name: "renders" })}>
            <Spinner data-icon="inline-start" aria-hidden />
            {busy} in progress
          </Button>
        )}
        <IconButton label={dark ? "Switch to light appearance" : "Switch to dark appearance"} onClick={toggleTheme}>
          {dark ? <SunIcon /> : <MoonIcon />}
        </IconButton>
        <IconButton label="How Moco works" onClick={onHelp}>
          <CircleHelpIcon />
        </IconButton>
      </div>
    </header>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Where you are, as a trail you can climb back up: My series › Hanuman’s leap › Episode 2.
function Crumbs() {
  const route = useApp((s) => s.route),
    library = useApp((s) => s.library),
    go = useApp((s) => s.go);
  const seriesTitle = (id: string) => library.find((s) => s.id === id)?.title ?? "Series";
  const trail: { label: string; to?: Route }[] =
    route.name === "series"
      ? [{ label: "My series", to: { name: "library" } }, { label: seriesTitle(route.id) }]
      : route.name === "episode"
        ? [
            { label: "My series", to: { name: "library" } },
            { label: seriesTitle(route.seriesId), to: { name: "series", id: route.seriesId } },
            { label: `Episode ${Number(route.episodeId.replace(/\D/g, ""))}` },
          ]
        : [{ label: [...NAV, ...FOOTER_NAV].find((n) => n.name === route.name)?.label ?? "Settings" }];
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {trail.map((crumb, i) => (
          <Fragment key={crumb.label + i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="min-w-0">
              {crumb.to ? (
                <BreadcrumbLink asChild>
                  <button className="max-w-56 truncate" onClick={() => go(crumb.to!)}>
                    {crumb.label}
                  </button>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function Palette({ onHelp }: { onHelp(): void }) {
  const open = useApp((s) => s.palette),
    library = useApp((s) => s.library),
    dark = useApp((s) => s.dark),
    go = useApp((s) => s.go);
  const ran = useRef(false);
  const setOpen = (value: boolean) => useApp.getState().setPalette(value);
  const run = (action: () => void) => {
    ran.current = true;
    setOpen(false);
    action();
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Moco"
      description="Jump to a page or a series, or run an action."
      onCloseAutoFocus={(event) => {
        // After an action the old focus belongs to the page we left; keep where the action put it.
        if (ran.current) event.preventDefault();
        ran.current = false;
      }}
    >
      <CommandInput placeholder="Search series, pages and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(newSeries)}>
            <PlusIcon />
            New series
            <CommandShortcut>{MOD_KEY} N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(toggleTheme)}>
            {dark ? <SunIcon /> : <MoonIcon />}
            Switch to {dark ? "light" : "dark"} appearance
          </CommandItem>
          <CommandItem onSelect={() => run(onHelp)}>
            <CircleHelpIcon />
            How Moco works
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {[...NAV, ...FOOTER_NAV].map((item) => (
            <CommandItem key={item.name} onSelect={() => run(() => go({ name: item.name } as Route))}>
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {library.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Series">
              {library.map((series) => (
                <CommandItem
                  key={series.id}
                  value={`${series.title} ${series.id}`}
                  keywords={[series.premise]}
                  onSelect={() => run(() => go({ name: "series", id: series.id }))}
                >
                  <FilmIcon />
                  <span className="truncate">{series.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

const HOW_IT_WORKS = [
  ["Start with a story", "Describe an idea. Moco plans a series, a cast and an episode arc, then stops for your review."],
  ["Make it your own", "Approve each step or ask for changes: the plan, the cast, the script, a sample shot, the preview."],
  ["Bring it to life", "Moco voices it, animates every shot with the kit, and renders a vertical MP4 on this computer."],
] as const;

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const go = useApp((s) => s.go);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your idea-to-reel studio</DialogTitle>
          <DialogDescription>Three steps from a story idea to a finished vertical video.</DialogDescription>
        </DialogHeader>
        <ItemGroup className="gap-2">
          {HOW_IT_WORKS.map(([title, detail], i) => (
            <Item key={title} role="listitem" variant="muted">
              <ItemMedia variant="icon" className="text-xs font-semibold tabular-nums">
                {i + 1}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{title}</ItemTitle>
                <ItemDescription className="line-clamp-none">{detail}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
        <p className="text-sm text-muted-foreground">
          Moco writes with the Claude Code on this computer, on your own Claude plan.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button
            onClick={() => {
              onOpenChange(false);
              go({ name: "settings", section: "ai" });
            }}
          >
            Check my AI connection
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

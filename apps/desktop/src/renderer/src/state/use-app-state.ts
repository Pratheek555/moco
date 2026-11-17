import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppInfo, Project, ProviderId, ProviderStatus, RunState, Skill, StarterSkill, Theme } from "../../../shared/api.ts";
import { api, errorMessage, run } from "../lib/api.ts";
import type { AppState, Route, SettingsSection } from "./app-context.ts";
import { savedRoute, savePreference } from "./preferences.ts";
import { hydrateRunStates, transitionProject } from "./project-state.ts";

export const providers: ProviderId[] = ["codex", "claude-code"];
const newestFirst = <T extends { updatedAt?: string; importedAt?: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (b.updatedAt ?? b.importedAt ?? "").localeCompare(a.updatedAt ?? a.importedAt ?? ""));

export function useAppState() {
  const [info, updateInfo] = useState<AppInfo>();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [starterSkills, setStarterSkills] = useState<StarterSkill[]>([]);
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderStatus>>>({});
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const [attention, setAttention] = useState<AppState["attention"]>({});
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameProject, requestRename] = useState<Project | null>(null);
  const [deleteProject, requestDelete] = useState<Project | null>(null);
  const routeRef = useRef<Route>(route);
  const navigated = useRef(false);
  const statesRef = useRef<Record<string, RunState>>({});
  const statusesRef = useRef(statuses);
  const checking = useRef<Partial<Record<ProviderId, Promise<ProviderStatus>>>>({});
  const receivedStates = useRef(new Set<string>());
  const refreshSequence = useRef(0);
  const projectSequence = useRef(0);

  const navigate = useCallback((next: Route) => {
    navigated.current = true;
    routeRef.current = next;
    setRoute(next);
    savePreference("route", JSON.stringify(next));
    if (next.name === "project") setAttention(old => {
      if (!old[next.id]) return old;
      const copy = { ...old }; delete copy[next.id]; return copy;
    });
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const projectRequest = ++projectSequence.current;
    const [nextProjects, nextSkills] = await Promise.all([api.projects(), api.skills()]);
    if (sequence !== refreshSequence.current) return;
    if (projectRequest === projectSequence.current) {
      setProjects(newestFirst(nextProjects));
      const active = routeRef.current;
      if (active.name === "project" && !nextProjects.some(project => project.id === active.id)) navigate({ name: "home" });
    }
    setSkills(newestFirst(nextSkills));
  }, [navigate]);

  const checkProvider = useCallback((provider: ProviderId): Promise<ProviderStatus> => {
    const pending = checking.current[provider];
    if (pending) return pending;
    const promise = (async () => {
      let status: ProviderStatus;
      try { status = await api.status(provider); }
      catch (error) { status = { ok: false, issue: "unavailable", reason: errorMessage(error) }; }
      statusesRef.current = { ...statusesRef.current, [provider]: status };
      setStatuses(statusesRef.current);
      return status;
    })();
    checking.current[provider] = promise;
    void promise.finally(() => { delete checking.current[provider]; });
    return promise;
  }, []);

  const openSettings = useCallback((section: SettingsSection = "general") => {
    setSettingsSection(section); setSettingsOpen(true);
  }, []);
  const openNewProject = useCallback(() => setNewProjectOpen(true), []);

  useEffect(() => {
    let closed = false;
    const projectRequest = ++projectSequence.current;
    const libraryRequest = ++refreshSequence.current;
    setLoading(true);
    void (async () => {
      const [app, projectList, skillList, starters, states] = await Promise.allSettled([
        api.info(), api.projects(), api.skills(), api.starterSkills(), api.projectStates(),
      ]);
      if (closed) return;
      if (app.status === "fulfilled") updateInfo(app.value);
      if (projectList.status === "fulfilled" && projectRequest === projectSequence.current) setProjects(newestFirst(projectList.value));
      if (skillList.status === "fulfilled" && libraryRequest === refreshSequence.current) setSkills(newestFirst(skillList.value));
      setStarterSkills(starters.status === "fulfilled" ? starters.value : []);
      if (states.status === "fulfilled") {
        statesRef.current = hydrateRunStates(states.value, statesRef.current, receivedStates.current);
        setRunStates(statesRef.current);
      }
      const failed = [app, projectList, skillList, states].find(result => result.status === "rejected");
      setLoadError(failed?.status === "rejected" ? errorMessage(failed.reason) : "");
      if (!navigated.current && projectList.status === "fulfilled") {
        const saved = savedRoute();
        navigate(saved.name !== "project" || projectList.value.some(project => project.id === saved.id) ? saved : { name: "home" });
      }
      setLoaded(true);
      setLoading(false);
    })();
    return () => { closed = true; };
  }, [loadAttempt, navigate]);

  useEffect(() => {
    for (const provider of providers) void checkProvider(provider);
    let lastCheck = Date.now();
    const onFocus = () => {
      if (Date.now() - lastCheck < 3_000) return;
      lastCheck = Date.now();
      for (const provider of providers) if (!statusesRef.current[provider]?.ok) void checkProvider(provider);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkProvider]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const off = api.onUpdate(update => {
      if ("error" in update) { toast.error(errorMessage(update.error)); return; }
      if (!update.state) return;
      const id = update.projectId;
      receivedStates.current.add(id);
      const transition = transitionProject(statesRef.current, id, update.state, routeRef.current);
      if (!transition.changed) return;
      statesRef.current = transition.states;
      setRunStates(transition.states);
      if (transition.attention) setAttention(old => ({ ...old, [id]: transition.attention! }));
      clearTimeout(timer);
      timer = setTimeout(() => {
        void run(async () => {
          const sequence = ++projectSequence.current;
          const list = await api.projects();
          if (!closed && sequence === projectSequence.current) setProjects(newestFirst(list));
        });
      }, 500);
    });
    return () => { closed = true; off(); clearTimeout(timer); };
  }, []);

  useEffect(() => api.onCommand(command => {
    if (command.type === "open-project") {
      setPaletteOpen(false); setNewProjectOpen(false); setSettingsOpen(false);
      navigate({ name: "project", id: command.projectId });
    }
    else if (command.type === "new-project") openNewProject();
    else openSettings();
  }), [navigate, openNewProject, openSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (!["k", "n", ","].includes(key)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (key === "k") setPaletteOpen(old => !old);
      else if (key === "n") openNewProject();
      else openSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewProject, openSettings]);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", info?.theme === "dark" || ((!info || info.theme === "system") && system.matches));
    apply(); system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [info?.theme]);
  useEffect(() => {
    if (info) document.documentElement.dataset.platform = info.platform;
  }, [info?.platform]);

  const themeRevision = useRef(0);
  const setTheme = useCallback(async (theme: Theme) => {
    const revision = ++themeRevision.current;
    const previous = info?.theme ?? "system";
    updateInfo(old => old ? { ...old, theme } : old);
    try { await api.setTheme(theme); }
    catch (error) {
      if (themeRevision.current === revision) updateInfo(old => old ? { ...old, theme: previous } : old);
      throw error;
    }
  }, [info?.theme]);
  const setNotifications = useCallback(async (notifications: boolean) => {
    await api.setNotifications(notifications);
    updateInfo(old => old ? { ...old, notifications } : old);
  }, []);

  const app = useMemo<AppState>(() => ({
    info, loaded, projects, skills, starterSkills, statuses, runStates, attention, route, navigate, refresh,
    checkProvider, setTheme, setNotifications, openSettings, openNewProject, requestRename, requestDelete,
  }), [info, loaded, projects, skills, starterSkills, statuses, runStates, attention, route, navigate, refresh,
    checkProvider, setTheme, setNotifications, openSettings, openNewProject]);

  return {
    app, loadError, loading, retryLoad: () => setLoadAttempt(old => old + 1),
    newProjectOpen, setNewProjectOpen, settingsOpen, setSettingsOpen, settingsSection, setSettingsSection,
    paletteOpen, setPaletteOpen, renameProject, requestRename, deleteProject, requestDelete,
  };
}

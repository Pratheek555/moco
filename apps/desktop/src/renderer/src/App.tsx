import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUp, FilePlus, Folder, FolderOpen, Plus, RefreshCw, X } from "lucide-react";
import type { Project, ProjectEvent, ProjectView, ProviderId, ProviderStatus, Skill } from "../../shared/api.ts";
import { providerLabels } from "../../shared/api.ts";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { ProjectScreen } from "./Project.tsx";
import { api, type Run } from "./lib/api.ts";

const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(error);

export function App() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [provider, setProvider] = useState<ProviderId>("codex");
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderStatus>>>({});
  const [error, setError] = useState("");
  const [view, setView] = useState<ProjectView>();
  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState("");
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const active = useRef("");
  const buffered = useRef<ProjectEvent[]>([]);
  const changedState = useRef<ProjectView["state"]>(undefined);
  const run: Run = useCallback(async work => { try { setError(""); await work(); } catch (e) { setError(message(e)); } }, []);
  const selectedProvider = view?.project.provider ?? provider;
  const status = statuses[selectedProvider];
  const providerLabel = providerLabels[selectedProvider];
  const refresh = useCallback(async () => {
    const [skills, projects] = await Promise.all([api.skills(), api.projects()]);
    setSkills(skills); setProjects(projects); setSkillId(id => id || skills[0]?.id || "");
  }, []);
  useEffect(() => {
    const off = api.onUpdate(update => {
      if ("error" in update) { setError(update.error); setView(old => old ? { ...old, state: "error" } : old); return; }
      if (update.projectId !== active.current) return;
      if (update.record) buffered.current.push(update.record);
      if (update.state) changedState.current = update.state;
      setView(old => {
        if (!old || old.project.id !== update.projectId) return old;
        const record = update.record;
        return { ...old, state: update.state ?? old.state, events: record && !old.events.some(e => e.id === record.id) ? [...old.events, record] : old.events };
      });
    });
    void run(async () => { await refresh(); const info = await api.info(); setFolder(info.projectsDir); setTheme(info.theme); });
    return off;
  }, [run, refresh]);
  useEffect(() => {
    let closed = false;
    void run(async () => {
      const status = await api.status(selectedProvider);
      if (!closed) setStatuses(old => ({ ...old, [selectedProvider]: status }));
    });
    return () => { closed = true; };
  }, [selectedProvider, run]);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const update = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && system.matches));
    update(); system.addEventListener("change", update);
    return () => system.removeEventListener("change", update);
  }, [theme]);
  async function open(project: Project) {
    active.current = project.id; buffered.current = []; changedState.current = undefined;
    const result = await api.project(project.id);
    if (active.current !== project.id) return;
    const ids = new Set(result.events.map(e => e.id));
    setView({ ...result, state: changedState.current ?? result.state, events: [...result.events, ...buffered.current.filter(e => !ids.has(e.id))] });
    buffered.current = [];
  }
  async function importSkill(kind: "file" | "folder") {
    const skill = await api.importSkill(kind);
    if (skill) { await refresh(); setSkillId(skill.id); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    await run(async () => { const project = await api.create(name, skillId, provider); await refresh(); await open(project); setName(""); });
    setBusy(false);
  }
  function home() { active.current = ""; setView(undefined); void run(refresh); }
  return <div className="app-shell">
    <aside className="navigation">
      <button className="brand" onClick={home}><span className="brand-mark">m</span> moco</button>
      <Button variant="outline" className="w-full justify-start" onClick={home}><Plus /> New project</Button>
      <div className="eyebrow">Your projects</div>
      <nav aria-label="Projects">{projects.map(project => <button key={project.id} className={`project-link ${view?.project.id === project.id ? "selected" : ""}`} onClick={() => void run(() => open(project))}><Folder size={15} /><span>{project.name}<small>{project.skill.name} · {providerLabels[project.provider]}</small></span></button>)}</nav>
      <div className="navigation-footer"><label htmlFor="theme" className="hint">Appearance</label><select id="theme" value={theme} onChange={e => { const next = e.target.value as typeof theme; void run(async () => { await api.setTheme(next); setTheme(next); }); }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><span className={`status-dot ${status?.ok ? "ready" : ""}`} /> {providerLabel}<small>{status ? "Your subscription. Your workspace." : "Checking connection…"}</small></div>
    </aside>
    <main className="main-panel">
      {error && <div role="alert" className="error-banner"><span>{error}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss error" onClick={() => setError("")}><X /></Button></div>}
      {status && !status.ok && <div className="setup-banner"><strong>Connect {providerLabel} to get started</strong><p>{status.reason}</p><Button size="sm" variant="outline" onClick={() => void run(async () => { const status = await api.status(selectedProvider); setStatuses(old => ({ ...old, [selectedProvider]: status })); })}><RefreshCw /> Check again</Button></div>}
      {view ? <ProjectScreen key={view.project.id} view={view} ready={status?.ok === true} run={run} onBack={home} /> : <div className="home">
        <div className="eyebrow">A little idea. Anything you can make.</div><h1>What will you create?</h1><p className="intro">Bring a skill. Give your agent a workspace. Make it yours.</p>
        <form className="new-project" onSubmit={event => void create(event)}>
          <h2>New project</h2>
          <label htmlFor="project-name">Project name</label><Input id="project-name" value={name} onChange={e => setName(e.target.value)} placeholder="My next video" maxLength={120} required />
          <label htmlFor="project-provider">AI provider</label><select id="project-provider" value={provider} onChange={e => setProvider(e.target.value as ProviderId)}>{Object.entries(providerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <label htmlFor="project-skill">Skill</label><select id="project-skill" value={skillId} onChange={e => setSkillId(e.target.value)} required><option value="" disabled>Choose an imported skill</option>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name} · {new Date(skill.importedAt).toLocaleDateString()}</option>)}</select>
          <div className="row"><Button type="button" variant="ghost" size="sm" onClick={() => void run(() => importSkill("file"))}><FilePlus /> Import SKILL.md</Button><Button type="button" variant="ghost" size="sm" onClick={() => void run(() => importSkill("folder"))}><FolderOpen /> Import folder</Button></div>
          <Button type="submit" disabled={busy || !name.trim() || !skillId}>{busy ? "Creating…" : "Create project"}<ArrowUp /></Button>
          <p className="hint">Workspaces are saved in {folder || "Documents/moco"}.</p>
        </form>
        <section className="skill-library" aria-label="Skill library"><div className="section-heading"><h2>Skill library</h2><span>{skills.length} imported</span></div>{!skills.length && <p className="muted">Import a SKILL.md, or a whole folder to include scripts, assets, and other supporting files.</p>}{skills.map(skill => <article key={skill.id}><div className="row"><strong>{skill.name}</strong><span className="hint">{new Date(skill.importedAt).toLocaleDateString()}</span></div><p>{skill.description}</p></article>)}</section>
      </div>}
    </main>
  </div>;
}

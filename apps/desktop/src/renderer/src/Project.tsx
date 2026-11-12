import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowUp, Check, FolderOpen, Paperclip, RefreshCw, Square, X } from "lucide-react";
import type { ProjectView, WorkspaceFile } from "../../shared/api.ts";
import { mediaUrl, providerLabels } from "../../shared/api.ts";
import type { Question } from "@moco/agent/types";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import { transcript } from "./conversation.ts";
import { api, type Run } from "./lib/api.ts";

export function ProjectScreen({ view, ready, run, onBack }: { view: ProjectView; ready: boolean; run: Run; onBack: () => void }) {
  const { project, events, state } = view;
  const providerLabel = providerLabels[project.provider];
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [fileTab, setFileTab] = useState<"media" | "all">("media");
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const content = transcript(events);
  const tasks = [...events].reverse().find(e => e.event.type === "tasks")?.event;
  const running = state === "running" || state === "waiting";
  const refreshFiles = useCallback(async () => setFiles(await api.files(project.id)), [project.id]);
  useEffect(() => {
    let closed = false, checking = false;
    const refresh = async () => {
      if (checking) return; checking = true;
      try { const files = await api.files(project.id); if (!closed) setFiles(files); } catch { /* manual refresh reports errors */ }
      finally { checking = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { closed = true; clearInterval(timer); };
  }, [project.id]);
  useEffect(() => { if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" }); }, [events.length]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending || (!text.trim() && !attachments.length)) return;
    setSending(true);
    await run(async () => { await api.send(project.id, text, attachments); setText(""); setAttachments([]); nearBottom.current = true; });
    setSending(false);
  }
  const delivered = content.flatMap(block => block.type === "file" ? [block.path] : []);
  const visibleFiles = fileTab === "all" ? files : files.filter(file => delivered.includes(file.path) || (file.kind !== "file" && !file.path.startsWith("uploads/")));
  return <div className="project-screen">
    <header className="project-header"><Button variant="ghost" size="icon" aria-label="Back to home" onClick={onBack}><ArrowLeft /></Button><div><h1>{project.name}</h1><small>{project.skill.name} · {providerLabel}</small></div><span className={`run-state ${state}`}><span className="status-dot" />{state === "waiting" ? "Waiting for you" : state === "running" ? "Running" : state === "error" ? "Error · send a message to retry" : "Idle"}</span><Button variant="outline" size="sm" onClick={() => void run(() => api.openWorkspace(project.id))}><FolderOpen /> Workspace</Button></header>
    <div className="project-body"><section className="chat-column" aria-label="Conversation">
      <div className="transcript" onScroll={e => { const node = e.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
        {!events.length && <div className="empty-chat"><span className="brand-mark">m</span><h2>Your workspace is ready.</h2><p>Tell the agent what you want to make.<br />It will follow <strong>{project.skill.name}</strong>.</p></div>}
        {content.map(block => {
          switch (block.type) {
            case "text": return <div key={block.id} className={`chat-message ${block.role}`}><small>{block.role === "user" ? "You" : providerLabel}</small><div className="prose">{block.text}</div>{block.files?.map(file => <div className="attachment-note" key={file}><Paperclip size={12} />{file.split("/").pop()}</div>)}</div>;
            case "thinking": return <details key={block.id} className="thinking"><summary>Thinking</summary><div className="prose">{block.text}</div></details>;
            case "tools": return <details key={block.id} className="tool-group"><summary>{block.tools.length} tool {block.tools.length === 1 ? "action" : "actions"}{block.tools.some(t => t.result === undefined) && running ? " · working" : ""}</summary>{block.tools.map(tool => <details key={tool.id}><summary>{tool.isError ? "! " : tool.result !== undefined ? "✓ " : "· "}{tool.name}</summary><pre>{JSON.stringify(tool.input, null, 2)}</pre>{tool.result !== undefined && <pre className={tool.isError ? "tool-error" : ""}>{typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>}</details>)}</details>;
            case "activity": return <div className="activity" key={block.id}><span className="status-dot" />{block.description} <small>{block.status}</small></div>;
            case "question": return <QuestionCard key={block.id} id={block.questionId} questions={block.questions} answered={block.answers} onAnswer={answers => api.answer(project.id, block.questionId, answers)} run={run} />;
            case "file": { const file = files.find(file => file.path === block.path); return <div key={block.id} className="delivered-file"><small>{block.label || `Shared by ${providerLabel}`}</small><FileCard projectId={project.id} file={file ?? { path: block.path, name: block.path.split("/").pop()!, kind: "file", size: 0, modifiedAt: "" }} run={run} /></div>; }
            case "error": return <div role="alert" className="chat-error" key={block.id}>{block.message}</div>;
            case "stopped": return <p key={block.id} className="hint">Stopped. Send a message to continue this conversation.</p>;
          }
        })}<div ref={bottom} />
      </div>
      <form className="composer" onSubmit={event => void send(event)}>
        {!!attachments.length && <div className="attachment-chips">{attachments.map(file => <span key={file}>{file.split("/").pop()}<button type="button" aria-label={`Remove ${file.split("/").pop()}`} onClick={() => setAttachments(old => old.filter(f => f !== file))}><X size={12} /></button></span>)}</div>}
        <Textarea aria-label="Message" value={text} onChange={e => setText(e.target.value)} placeholder={events.length ? "Reply, upload a file, or ask for a change…" : "What would you like to make?"} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <div className="composer-actions"><Button variant="ghost" size="sm" type="button" onClick={() => void run(async () => { const added = await api.attach(project.id); setAttachments(old => [...old, ...added]); })}><Paperclip /> Attach files</Button><span className="hint">{running ? "Messages reach the agent while it works" : "Enter to send · Shift + Enter for a new line"}</span>{running && <Button type="button" variant="outline" size="sm" onClick={() => void run(() => api.stop(project.id))}><Square /> Stop</Button>}<Button type="submit" size="icon" aria-label="Send message" disabled={!ready || sending || (!text.trim() && !attachments.length)}><ArrowUp /></Button></div>
      </form>
    </section>
    <aside className="workspace-panel">
      {tasks?.type === "tasks" && !!tasks.tasks.length && <section className="task-list" aria-label="Agent tasks"><h2>Tasks</h2>{tasks.tasks.map(task => <div key={task.id} className={task.status}><span>{task.status === "completed" ? <Check size={14} /> : task.status === "in_progress" ? "◉" : "○"}</span>{task.subject}</div>)}</section>}
      <div className="section-heading"><h2>Files</h2><Button variant="ghost" size="icon-sm" aria-label="Refresh files" onClick={() => void run(refreshFiles)}><RefreshCw /></Button></div><div className="file-tabs"><button aria-pressed={fileTab === "media"} onClick={() => setFileTab("media")}>Outputs & media</button><button aria-pressed={fileTab === "all"} onClick={() => setFileTab("all")}>All files</button></div><p className="hint">Files appear as the agent creates them.</p>
      <div className="workspace-files">{visibleFiles.length ? visibleFiles.map(file => <FileCard key={file.path} projectId={project.id} file={file} run={run} />) : <p className="muted">Your files will appear here.</p>}</div>
    </aside></div>
  </div>;
}

function QuestionCard({ id, questions, answered, onAnswer, run }: { id: string; questions: Question[]; answered?: Record<string, string>; onAnswer: (answers: Record<string, string>) => Promise<void>; run: Run }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const answers = Object.fromEntries(questions.map(q => [q.question, [...selected[q.question] ?? [], ...(other[q.question]?.trim() ? [other[q.question]!.trim()] : [])].join(", ")]));
  return <form className="question-card" aria-label="Agent question" onSubmit={event => { event.preventDefault(); setBusy(true); void run(() => onAnswer(answers)).finally(() => setBusy(false)); }}>
    <small>{answered ? "Answered" : "Agent has a question"}</small>{questions.map((question, qi) => <fieldset key={question.question} disabled={!!answered || busy}><legend>{question.question}</legend>{answered ? <p className="prose">{answered[question.question]}</p> : <>{question.options.map((option, oi) => <label className="question-option" key={option.label}><input type={question.multiSelect ? "checkbox" : "radio"} name={`${id}-${qi}`} value={option.label} checked={(selected[question.question] ?? []).includes(option.label)} onChange={event => { setSelected(old => ({ ...old, [question.question]: question.multiSelect ? event.target.checked ? [...old[question.question] ?? [], option.label] : (old[question.question] ?? []).filter(x => x !== option.label) : [option.label] })); if (!question.multiSelect) setOther(old => ({ ...old, [question.question]: "" })); }} id={`${id}-${qi}-${oi}`} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}<Input aria-label={`Other: ${question.question}`} placeholder="Other — write your own answer" value={other[question.question] ?? ""} onChange={e => { setOther(old => ({ ...old, [question.question]: e.target.value })); if (!question.multiSelect) setSelected(old => ({ ...old, [question.question]: [] })); }} /></>}</fieldset>)}{!answered && <Button type="submit" size="sm" disabled={busy || Object.values(answers).some(answer => !answer)}>{busy ? "Sending…" : "Continue"}</Button>}
  </form>;
}

function FileCard({ projectId, file, run }: { projectId: string; file: WorkspaceFile; run: Run }) {
  const url = mediaUrl(projectId, file.path, file.modifiedAt);
  return <article className="file-card">
    {file.kind === "image" && <img src={url} alt={file.name} loading="lazy" />}
    {file.kind === "video" && <video src={url} controls preload="metadata" />}
    {file.kind === "audio" && <audio src={url} controls preload="metadata" />}
    <strong title={file.path}>{file.name}</strong><small title={file.path}>{file.path} {file.size ? `· ${(file.size / 1024 / 1024).toFixed(1)} MB` : ""}</small><div className="row"><Button variant="ghost" size="xs" onClick={() => void run(() => api.openFile(projectId, file.path, false))}>Open</Button><Button variant="ghost" size="xs" onClick={() => void run(() => api.openFile(projectId, file.path, true))}><FolderOpen /> Show in folder</Button></div>
  </article>;
}

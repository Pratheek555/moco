import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceStore, parseSkill, confinedFile, mediaType } from "../src/storage.ts";

let temp: string;
let store: WorkspaceStore;
const skillText = "---\nname: my-video\ndescription: >-\n  Make a video.\n  Any way you like.\n---\n# Instructions\nAsk the user first.\n";
beforeEach(async () => { temp = await mkdtemp(path.join(tmpdir(), "moco-store-")); store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "projects")); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
async function skillFile() { const file = path.join(temp, "SKILL.md"); await writeFile(file, skillText); return file; }

describe("skills", () => {
  it("parses YAML frontmatter, including BOM, CRLF and multiline descriptions", () => {
    expect(parseSkill("\uFEFF" + skillText.replaceAll("\n", "\r\n"))).toEqual({ name: "my-video", description: "Make a video. Any way you like." });
  });
  it.each(["no frontmatter", "---\nname: ../escape\ndescription: bad\n---\n", "---\nname: valid\n---\n", "---\nname: [\n---\n"])("rejects malformed or unsafe metadata", text => { expect(() => parseSkill(text)).toThrow(); });
  it("copies a single SKILL.md into the library and native project skill directory", async () => {
    const source = await skillFile();
    const skill = await store.importSkill(source);
    await writeFile(source, "source changed");
    const project = await store.createProject("A video", skill.id);
    expect(await readFile(path.join(project.workspace, ".agents/skills/my-video/SKILL.md"), "utf8")).toBe(skillText);
    expect(await store.skills()).toEqual([skill]);
  });
  it("copies supporting files from a folder and pins each imported version", async () => {
    const source = path.join(temp, "folder"); await mkdir(path.join(source, "kit"), { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), skillText); await writeFile(path.join(source, "kit/tool.py"), "original");
    const skill = await store.importSkill(source);
    const project = await store.createProject("Folder skill", skill.id, "claude-code");
    await writeFile(path.join(source, "kit/tool.py"), "changed");
    const second = await store.importSkill(source);
    expect(second.id).not.toBe(skill.id);
    expect(await readFile(path.join(project.workspace, ".claude/skills/my-video/kit/tool.py"), "utf8")).toBe("original");
  });
  it("clearly rejects a folder without SKILL.md", async () => {
    const folder = path.join(temp, "empty"); await mkdir(folder);
    await expect(store.importSkill(folder)).rejects.toThrow("no readable SKILL.md");
  });
  it("rejects links in skill folders", async () => {
    const folder = path.join(temp, "linked"); await mkdir(folder); await writeFile(path.join(folder, "SKILL.md"), skillText);
    const outside = path.join(temp, "other"); await mkdir(outside);
    await symlink(outside, path.join(folder, "kit"), process.platform === "win32" ? "junction" : "dir");
    await expect(store.importSkill(folder)).rejects.toThrow("symbolic links or junctions");
  });
});
describe("projects and workspace files", () => {
  it("defaults new projects to Codex and installs the complete skill in Codex's native directory", async () => {
    const source = path.join(temp, "codex-skill"); await mkdir(path.join(source, "kit"), { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), skillText); await writeFile(path.join(source, "kit/tool.py"), "supporting code");
    const skill = await store.importSkill(source);
    const project = await store.createProject("Codex project", skill.id);
    expect(await readFile(path.join(project.workspace, ".agents/skills/my-video/kit/tool.py"), "utf8")).toBe("supporting code");
    await store.record(project.id, { type: "session", sessionId: "codex-thread", skills: [skill.name] });
    const reopened = await new WorkspaceStore(store.dataDir, store.projectsDir).project(project.id);
    expect(reopened).toMatchObject({ provider: "codex", sessionId: "codex-thread" });
  });
  it("treats legacy projects as Claude Code without losing their resumable session", async () => {
    const project = await store.createProject("Existing project", (await store.importSkill(await skillFile())).id, "claude-code");
    const { provider: _, ...legacy } = project;
    await writeFile(path.join(store.dataDir, "projects", project.id, "project.json"), JSON.stringify({ ...legacy, sessionId: "claude-session" }));
    expect(await store.project(project.id)).toMatchObject({ provider: "claude-code", sessionId: "claude-session" });
  });
  it("reopens a project and its ordered conversation/session after restart", async () => {
    const skill = await store.importSkill(await skillFile());
    const project = await store.createProject("../../ My project", skill.id);
    expect(path.dirname(project.workspace)).toBe(store.projectsDir);
    await Promise.all([
      store.record(project.id, { type: "user", text: "Hello", files: [] }),
      store.record(project.id, { type: "session", sessionId: "provider-session", skills: [skill.name] }),
      store.record(project.id, { type: "text", messageId: "reply", text: "Hi" }),
    ]);
    const reopened = new WorkspaceStore(store.dataDir, store.projectsDir);
    expect((await reopened.project(project.id)).sessionId).toBe("provider-session");
    expect((await reopened.conversation(project.id)).map(e => e.event.type)).toEqual(["user", "session", "text"]);
    expect(await reopened.projects()).toHaveLength(1);
  });
  it("copies duplicate upload names without overwriting and discovers generated media", async () => {
    const project = await store.createProject("Uploads", (await store.importSkill(await skillFile())).id);
    const source = path.join(temp, "voice.wav"); await writeFile(source, "audio");
    const files = await store.attach(project.id, [source, source]);
    expect(files).toHaveLength(2); expect(files[0]).not.toBe(files[1]);
    await writeFile(path.join(project.workspace, "outbox/preview.PNG"), "image");
    await mkdir(path.join(project.workspace, "node_modules")); await writeFile(path.join(project.workspace, "node_modules/hidden.mp4"), "skip");
    const listed = await store.files(project.id);
    expect(listed.map(f => f.kind).sort()).toEqual(["audio", "audio", "image"]);
    expect(listed.find(f => f.name === "preview.PNG")?.path).toBe("outbox/preview.PNG");
  });
});
describe("media path confinement", () => {
  it("accepts workspace files and rejects traversal, absolute paths, alternate streams, folders, and symlink escapes", async () => {
    const root = path.join(temp, "workspace"), outside = path.join(temp, "outside");
    await mkdir(root); await mkdir(outside); await writeFile(path.join(root, "hello world.mp4"), "video"); await writeFile(path.join(outside, "private.mp4"), "private");
    expect(await confinedFile(root, "hello world.mp4")).toBe(path.join(root, "hello world.mp4"));
    for (const bad of ["../outside/private.mp4", "..\\outside\\private.mp4", path.join(outside, "private.mp4"), "hello world.mp4:stream", "", ".", "\0"])
      await expect(confinedFile(root, bad)).rejects.toThrow();
    await symlink(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    await expect(confinedFile(root, "link/private.mp4")).rejects.toThrow("outside");
    expect(mediaType("page.html")).toBeUndefined(); expect(mediaType("active.svg")).toBeUndefined(); expect(mediaType("VIDEO.MP4")).toBe("video/mp4");
  });
});

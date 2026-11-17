import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceStore, parseSkill, confinedFile, mediaType, MAX_UPLOAD_BYTES } from "../src/storage.ts";
import { randomUUID } from "node:crypto";

let temp: string;
let store: WorkspaceStore;
const skillText = "---\nname: my-video\ndescription: >-\n  Make a video.\n  Any way you like.\n---\n# Instructions\nAsk the user first.\n";
beforeEach(async () => { temp = await mkdtemp(path.join(tmpdir(), "moco-store-")); store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "projects")); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
async function skillFile() { const file = path.join(temp, "SKILL.md"); await writeFile(file, skillText); return file; }

describe("skills", () => {
  it("skips broken or unreadable skill metadata and lists the newest version first", async () => {
    const first = await store.importSkill(await skillFile()), second = await store.importSkill(await skillFile());
    first.importedAt = "2025-01-01T00:00:00.000Z"; second.importedAt = "2026-01-01T00:00:00.000Z";
    for (const skill of [first, second]) await writeFile(path.join(store.dataDir, "skills", skill.id, "skill.json"), JSON.stringify(skill));
    for (const content of ["broken json", "{}", "null"]) {
      const dir = path.join(store.dataDir, "skills", randomUUID()); await mkdir(dir); await writeFile(path.join(dir, "skill.json"), content);
    }
    await mkdir(path.join(store.dataDir, "skills", randomUUID(), "skill.json"), { recursive: true });
    expect(await store.skills()).toEqual([second, first]);
  });
  it("removes only the library copy and preserves a project's pinned skill", async () => {
    const skill = await store.importSkill(await skillFile());
    const project = await store.createProject("Keep my skill", skill.id);
    await store.deleteSkill(skill.id);
    expect(await store.skills()).toEqual([]);
    await expect(readFile(path.join(store.dataDir, "skills", skill.id, "skill.json"))).rejects.toThrow();
    expect(await readFile(path.join(project.workspace, ".agents/skills/my-video/SKILL.md"), "utf8")).toBe(skillText);
    expect((await store.project(project.id)).skill).toEqual(skill);
    await expect(store.deleteSkill("../outside")).rejects.toThrow("Invalid");
  });
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
  it("renames atomically alongside conversation writes without renaming the project folder or losing its session", async () => {
    const project = await store.createProject("Original", (await store.importSkill(await skillFile())).id);
    await Promise.all([
      store.record(project.id, { type: "session", sessionId: "persistent-session", skills: [project.skill.name] }),
      store.renameProject(project.id, "  New name  "),
      store.record(project.id, { type: "turn_end", status: "completed" }),
    ]);
    expect(await new WorkspaceStore(store.dataDir, store.projectsDir).project(project.id)).toMatchObject({ name: "New name", workspace: project.workspace, sessionId: "persistent-session" });
    expect((await readdir(path.join(store.dataDir, "projects", project.id))).some(file => file.endsWith(".tmp"))).toBe(false);
    for (const invalid of ["", "   ", "x".repeat(121)]) await expect(store.renameProject(project.id, invalid)).rejects.toThrow("1–120");
    expect((await store.renameProject(project.id, "x".repeat(120))).name).toHaveLength(120);
  });
  it("serializes deletion after existing writes and never touches workspace files", async () => {
    const project = await store.createProject("Delete me", (await store.importSkill(await skillFile())).id);
    await writeFile(path.join(project.workspace, "outbox/keep.txt"), "keep me");
    const writing = store.record(project.id, { type: "user", text: "Saved before deletion", files: [] });
    const rename = store.renameProject(project.id, "Final name");
    const deleted = store.deleteProject(project.id);
    await Promise.all([writing, rename]);
    expect(await deleted).toMatchObject({ id: project.id, name: "Final name", workspace: project.workspace });
    expect(await readFile(path.join(project.workspace, "outbox/keep.txt"), "utf8")).toBe("keep me");
    expect(await store.projects()).toEqual([]);
    expect(await readdir(path.join(store.dataDir, "projects"))).toEqual([]);
    await expect(store.renameProject(project.id, "Cannot resurrect")).rejects.toThrow();
    await expect(store.deleteProject("../outside")).rejects.toThrow("Invalid");
  });
  it("skips unreadable and corrupt project records without hiding valid projects", async () => {
    const project = await store.createProject("Healthy", (await store.importSkill(await skillFile())).id);
    for (const content of ["not json", "{}", "null", JSON.stringify({ ...project, updatedAt: 1 })]) {
      const dir = path.join(store.dataDir, "projects", randomUUID()); await mkdir(dir); await writeFile(path.join(dir, "project.json"), content);
    }
    await mkdir(path.join(store.dataDir, "projects", randomUUID(), "project.json"), { recursive: true });
    expect(await store.projects()).toEqual([project]);
  });
  it("writes pasted bytes under unique safe basenames, preserving typed array views", async () => {
    const project = await store.createProject("Paste", (await store.importSkill(await skillFile())).id);
    const bytes = new Uint8Array([0, 10, 20, 30]).subarray(1, 3);
    const [first] = await store.attachData(project.id, "../../escape\\image.png:stream", bytes);
    const [second] = await store.attachData(project.id, "image.png:stream", bytes);
    expect(first).toMatch(/^uploads\/[a-f0-9-]+-image.png_stream$/); expect(first).not.toBe(second);
    expect(await readFile(await confinedFile(project.workspace, first!))).toEqual(Buffer.from([10, 20]));
    for (const invalid of [new Uint8Array(), new Uint8Array(MAX_UPLOAD_BYTES + 1), "not bytes" as unknown as Uint8Array])
      await expect(store.attachData(project.id, "image.png", invalid)).rejects.toThrow("100 MB");
  });
  it("blocks both pasted and copied uploads through a replaced uploads junction", async () => {
    const project = await store.createProject("Unsafe uploads", (await store.importSkill(await skillFile())).id);
    const outside = path.join(temp, "outside"); await mkdir(outside);
    await rm(path.join(project.workspace, "uploads"), { recursive: true });
    await symlink(outside, path.join(project.workspace, "uploads"), process.platform === "win32" ? "junction" : "dir");
    const source = path.join(temp, "voice.wav"); await writeFile(source, "audio");
    await expect(store.attachData(project.id, "../../escape.png", new Uint8Array([1]))).rejects.toThrow("outside");
    await expect(store.attach(project.id, [source])).rejects.toThrow("outside");
    expect(await readdir(outside)).toEqual([]);
  });
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

import { describe, expect, it } from "vitest";
import type { WorkspaceFile } from "../src/shared/api.ts";
import {
  buildTree, folderFiles, isTextLike, isUnseen, isViewable, markSeen, mediaDuration,
  outputFiles, parseSeen, sameFiles, seenFromListing, taskCounts, taskStatus, viewerList, visibleRows,
} from "../src/renderer/src/features/files/model.ts";

function file(path: string, overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return { path, name: path.split("/").pop()!, size: 1024, modifiedAt: "2026-11-14T12:00:00.000Z", kind: "file", ...overrides };
}

describe("file tree", () => {
  it("nests folders, puts folders first and uses natural name order at every level", () => {
    const files = [file("frame 10.png"), file("scenes/scene 10/note.txt"), file("frame 2.png"), file("scenes/scene 2/a.txt"), file("Assets/Z.png"), file("Assets/b.png"), file("scenes/title.txt")];
    const tree = buildTree(files);
    expect(tree.map(node => [node.type, node.name])).toEqual([["folder", "Assets"], ["folder", "scenes"], ["file", "frame 2.png"], ["file", "frame 10.png"]]);
    const scenes = tree.find(node => node.path === "scenes");
    if (scenes?.type !== "folder") throw new Error("Missing scenes folder");
    expect(scenes.children.map(node => node.name)).toEqual(["scene 2", "scene 10", "title.txt"]);
    const assets = tree[0];
    if (assets?.type !== "folder") throw new Error("Missing assets folder");
    expect(assets.children.map(node => node.name)).toEqual(["b.png", "Z.png"]);
    expect(visibleRows(tree, new Set(["scenes", "scenes/scene 2"])).map(row => [row.node.path, row.depth])).toEqual([
      ["Assets", 0], ["scenes", 0], ["scenes/scene 2", 1], ["scenes/scene 2/a.txt", 2], ["scenes/scene 10", 1], ["scenes/title.txt", 1], ["frame 2.png", 0], ["frame 10.png", 0],
    ]);
  });

  it("gives the same keys after reordering and metadata changes, and removes duplicate paths", () => {
    const files = [file("a/out.mp4"), file("b/out.mp4"), file("out.mp4")];
    const keys = (list: WorkspaceFile[]) => visibleRows(buildTree(list), new Set(["a", "b"])).map(row => row.node.key);
    expect(keys([...files].reverse().map(entry => ({ ...entry, size: 100 })))).toEqual(keys(files));
    expect(new Set(keys(files)).size).toBe(5);
    expect(keys([file("./a/out.mp4"), file("a\\out.mp4"), file("a/out.mp4")])).toEqual(["d:a", "f:a/out.mp4"]);
  });

  it("visits only expanded folders even with hundreds of nested files", () => {
    const files = Array.from({ length: 800 }, (_, index) => file(`scenes/scene ${index}/frame.png`));
    const tree = buildTree(files);
    expect(visibleRows(tree, new Set())).toHaveLength(1);
    expect(visibleRows(tree, new Set(["scenes"]))).toHaveLength(801);
    const rows = visibleRows(tree, new Set(["scenes", "scenes/scene 2"]));
    expect(rows).toHaveLength(802);
    expect(rows.filter(row => row.node.type === "file").map(row => row.node.path)).toEqual(["scenes/scene 2/frame.png"]);
  });

  it("selects only direct files in a folder, in the same natural order as its tree", () => {
    const files = [file("out/scene 10.mp4"), file("out/nested/hidden.mp4"), file("out/scene 2.mp4"), file("root.txt"), file("out/note.txt")];
    expect(folderFiles(files, "out").map(entry => entry.name)).toEqual(["note.txt", "scene 2.mp4", "scene 10.mp4"]);
    expect(folderFiles(files, "").map(entry => entry.path)).toEqual(["root.txt"]);
    expect(files[0]?.name).toBe("scene 10.mp4");
  });
});

describe("outputs and viewer navigation", () => {
  it("includes explicit deliveries and generated media, excludes other uploads, sorts newest first and deduplicates", () => {
    const video = file("out/final.mp4", { kind: "video", modifiedAt: "2026-11-14T13:00:00.000Z" });
    const files = [
      file("notes.md"), video, file("uploads/input.png", { kind: "image" }),
      file("uploads/shared.wav", { kind: "audio", modifiedAt: "2026-11-14T14:00:00.000Z" }),
      file("still.png", { kind: "image" }), file("music.mp3", { kind: "audio" }), video,
    ];
    expect(outputFiles(files, ["./notes.md", "uploads\\shared.wav", "out/final.mp4", "out/final.mp4", "missing.pdf"]).map(entry => entry.path)).toEqual([
      "uploads/shared.wav", "out/final.mp4", "notes.md", "still.png", "music.mp3",
    ]);
    expect(files).toHaveLength(7);
  });

  it("preserves the source snapshot order including text and removed paths", () => {
    const source = ["out/final.mp4", "out/note.txt", "out/missing.png", "out/final.mp4"];
    const list = viewerList("out/note.txt", source, []);
    expect(list).toEqual(["out/final.mp4", "out/note.txt", "out/missing.png"]);
    source.reverse();
    expect(list[0]).toBe("out/final.mp4");
  });

  it("falls back to all media in listing order and keeps missing or non-media targets viewable", () => {
    const files = [file("new.png", { kind: "image" }), file("notes.md"), file("uploads/old.mp4", { kind: "video" })];
    expect(viewerList("uploads/old.mp4", [], files)).toEqual(["new.png", "uploads/old.mp4"]);
    expect(viewerList("notes.md", [], files)).toEqual(["notes.md", "new.png", "uploads/old.mp4"]);
    expect(viewerList("missing.png", [], files)[0]).toBe("missing.png");
  });

  it("previews only the specified text types and never treats HTML or SVG as media", () => {
    for (const extension of "txt md json srt vtt csv log mjs js ts py yaml yml toml html css xml".split(" ")) expect(isTextLike(`file.${extension.toUpperCase()}`)).toBe(true);
    expect(isViewable(file("page.html"))).toBe(true);
    expect(isViewable(file("art.svg"))).toBe(false);
    expect(isViewable(file("archive.zip"))).toBe(false);
  });
});

describe("file revisions and seen state", () => {
  it("detects only listing changes relevant to refreshing cards", () => {
    const files = [file("a.png")];
    expect(sameFiles(files, files.map(entry => ({ ...entry })))).toBe(true);
    for (const change of [{ path: "b.png" }, { size: 2048 }, { modifiedAt: "2026-11-14T14:00:00.000Z" }]) expect(sameFiles(files, [file("a.png", change)])).toBe(false);
    expect(sameFiles(files, [])).toBe(false);
  });

  it("counts the initial listing as seen, then marks new or modified files as unseen", () => {
    const initial = file("existing.mp4");
    const seen = seenFromListing([initial]);
    expect(isUnseen(seen, initial)).toBe(false);
    expect(isUnseen(seen, file("new.mp4"))).toBe(true);
    const changed = { ...initial, modifiedAt: "2026-11-14T14:00:00.000Z" };
    expect(isUnseen(seen, changed)).toBe(true);
    const next = markSeen(seen, changed, [changed]);
    expect(isUnseen(next, changed)).toBe(false);
    expect(markSeen(next, changed, [changed])).toBe(next);
    expect(isUnseen(seen, changed)).toBe(true);
  });

  it("drops removed seen entries on a new view and safely reads corrupted storage", () => {
    const current = file("current.png");
    expect(markSeen({ "removed.png": "old" }, current, [current])).toEqual({ "current.png": current.modifiedAt });
    for (const value of [null, "", "not JSON", "null", "[]", "true"]) expect(parseSeen(value)).toBeUndefined();
    expect(parseSeen('{"file.png":"revision","other.png":123}')).toBeUndefined();
    expect(parseSeen('{"file.png":"revision"}')).toEqual({ "file.png": "revision" });
    expect(parseSeen("{}")).toEqual({});
    expect(seenFromListing([file("__proto__")])["__proto__"]).toBe(current.modifiedAt);
  });
});

it("counts only completed tasks and treats unknown statuses as pending", () => {
  const tasks = [{ id: "1", subject: "Done", status: "completed" }, { id: "2", subject: "Now", status: "in_progress" }, { id: "3", subject: "Next", status: "unknown" }];
  expect(taskCounts(tasks)).toEqual({ done: 1, total: 3 });
  expect(taskStatus(tasks[2]!)).toBe("pending");
});

it("formats media duration without invalid metadata badges", () => {
  expect([0, 7, 192, 3845].map(mediaDuration)).toEqual(["0:00", "0:07", "3:12", "1:04:05"]);
  expect(mediaDuration(Infinity)).toBe("");
  expect(mediaDuration(NaN)).toBe("");
});

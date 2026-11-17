import { afterEach, expect, it, vi } from "vitest";
import { getProjectDraft, updateProjectDraft } from "../src/renderer/src/features/project/draft-store.ts";
import { draftKey } from "../src/renderer/src/features/project/storage.ts";

afterEach(() => vi.unstubAllGlobals());
it("reconciles late upload and send completion without a mounted conversation", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  updateProjectDraft("late-completion", { text: "Draft", attachments: [] });
  // The async operation completes after the project has no mounted subscribers.
  updateProjectDraft("late-completion", old => ({ ...old, attachments: [...old.attachments, "uploads/voice.wav"] }));
  expect(getProjectDraft("late-completion")).toEqual({ text: "Draft", attachments: ["uploads/voice.wav"] });
  expect(JSON.parse(values.get(draftKey("late-completion"))!)).toEqual(getProjectDraft("late-completion"));
  updateProjectDraft("late-completion", { text: "", attachments: [] });
  expect(values.has(draftKey("late-completion"))).toBe(false);
  expect(getProjectDraft("late-completion")).toEqual({ text: "", attachments: [] });
});
it("keeps another project's draft independent and remains usable without storage", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Unavailable"); } });
  updateProjectDraft("independent-a", { text: "A", attachments: [] });
  updateProjectDraft("independent-b", { text: "B", attachments: [] });
  expect(getProjectDraft("independent-a").text).toBe("A");
  expect(getProjectDraft("independent-b").text).toBe("B");
});

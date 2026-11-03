import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPrompt, promptRef } from "../src/generator/prompts.ts";
import { TEMPLATE_STAGES, TEMPLATES } from "../src/templates/index.ts";
import { templateGuide } from "../src/templates/guide.ts";
import { allTemplates, setStylesDir } from "../src/templates/registry.ts";
import { advance, approveNext, setup, testWorld } from "./helpers.ts";

describe("templates", () => {
  it("has guidance for every stage, and the prompt still starts with its own header", () => {
    for (const template of TEMPLATES) {
      for (const stage of TEMPLATE_STAGES) expect(templateGuide(template.id, stage), `${template.id} ${stage}`).toContain(`## Template: ${template.name}`);
    }
    const prompt = loadPrompt("script", "cartoon-3d-short");
    expect(prompt.startsWith("<!-- prompt: script")).toBe(true);
    expect(prompt).toContain("Luckily");
    expect(loadPrompt("memory", "cartoon-3d-short")).toBe(loadPrompt("memory")); // stages a template doesn't guide stay as they are
  });

  it("changes the recorded prompt hash, so a template change makes artifacts stale", () => {
    expect(promptRef("script", "cartoon-3d-short").contentHash).not.toBe(promptRef("script").contentHash);
  });

  it("refuses a template that doesn't exist", async () => {
    const { engine } = await setup();
    await expect(engine.createSeries({ idea: "A bridge", language: "en", template: "nope" })).rejects.toThrow("unknown template");
  });

  it("guides every planning prompt and builds a world even when the AI picked a kit cast", async () => {
    const { engine, dir, ai } = await setup({ world: () => testWorld() }); // the default bible answer casts kit characters
    const seriesId = await engine.createSeries({ idea: "Soldiers march a bridge down", language: "en", episodes: 1, template: "cartoon-3d-short" });
    expect((await engine.status(seriesId)).series.template).toBe("cartoon-3d-short");
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
    await advance(engine, seriesId);

    const systems = ai.requests.map((request) => request.system);
    expect(systems.find((system) => system.includes("prompt: series"))).toContain("## Template: Cartoon 3D story short");
    expect(systems.find((system) => system.includes("prompt: world"))).toContain("Bean-shaped heads");
    const bible = JSON.parse(await readFile(join(dir, seriesId, "artifacts/bible.json"), "utf8"));
    expect(bible.data.cast.map((member: { kitCharacterId: string }) => member.kitCharacterId)).toEqual(testWorld().cast.map((member) => member.model));
  });

  it("uses a style learned from reference videos as a template, read from the styles folder", async () => {
    const { engine, ai } = await setup();
    const styles = await mkdtemp(join(tmpdir(), "moco-styles-"));
    const folder = join(styles, "deadpan-facts");
    await mkdir(folder, { recursive: true });
    const info = { id: "deadpan-facts", name: "Deadpan facts", tagline: "t", description: "d", tags: [], story: [], look: [], palette: { sky: ["#000000", "#ffffff"], ground: "#333333", accents: ["#ff0000"] }, world: "world", defaults: { episodes: 2 }, ideas: [] };
    await writeFile(join(folder, "moco-template.json"), JSON.stringify(info));
    await writeFile(join(folder, "moco-template.md"), "<!-- template: deadpan-facts v1 -->\n\n# series\nOne cause-and-effect chain per episode.\n");
    await writeFile(join(folder, "style.json"), JSON.stringify({ sources: ["https://youtu.be/x"] }));
    setStylesDir(styles); // what createEngine({ stylesDir }) does
    try {
      expect(allTemplates().find((template) => template.id === "deadpan-facts")).toMatchObject({ name: "Deadpan facts", learned: { dir: folder, sources: ["https://youtu.be/x"] } });
      expect(templateGuide("deadpan-facts", "series")).toContain("One cause-and-effect chain");
      expect(templateGuide("deadpan-facts", "script")).toBe(""); // stages it doesn't guide stay as they are
      const seriesId = await engine.createSeries({ idea: "A bridge", language: "en", episodes: 1, template: "deadpan-facts" });
      await advance(engine, seriesId);
      expect(ai.requests.find((request) => request.system.includes("prompt: series"))!.system).toContain("## Template: Deadpan facts");
    } finally {
      setStylesDir(undefined);
    }
  });
});

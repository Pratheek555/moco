import { describe, expect, it } from "vitest";
import { catalog } from "@moco/kit";
import { World } from "@moco/spec";
import { fallbackScene } from "../src/generator/context.ts";
import { validateScene, type SceneBrief } from "../src/loop/validate.ts";
import { checkWorld, worldCatalog, worldForShot } from "../src/planner/world.ts";
import { testWorld } from "./helpers.ts";

const parse = (raw: unknown) => World.parse(raw);
const issuesOf = (raw: ReturnType<typeof testWorld>) => checkWorld(parse(raw)).map((issue) => issue.problem).join("\n");

describe("checkWorld", () => {
  it("accepts a sound world", () => {
    expect(checkWorld(parse(testWorld()))).toEqual([]);
  });

  it("takes null for no parent, as models tend to write", () => {
    const world = testWorld();
    (world.models[0]!.parts[0] as { parent?: string | null }).parent = null;
    expect(checkWorld(parse(world))).toEqual([]);
  });

  it("refuses a loop of parents, which would hang the renderer", () => {
    const world = testWorld();
    world.models[1]!.parts = [
      { id: "a", parent: "b", shape: "sphere", size: [1, 1, 1], surface: "skin" },
      { id: "b", parent: "a", shape: "sphere", size: [1, 1, 1], surface: "skin" },
    ];
    expect(issuesOf(world)).toContain("form a loop");
  });

  it("says which humanoid joints are missing", () => {
    const world = testWorld();
    world.models[0]!.parts = world.models[0]!.parts.filter((part) => part.id !== "shin_R");
    expect(issuesOf(world)).toContain("shin_R");
  });

  it("catches parts, surfaces and models that don't exist", () => {
    const world = testWorld();
    world.models[1]!.parts[0]!.surface = "nothing";
    world.locations[0]!.set = [{ model: "ghost", at: [0, 0, 0] }];
    world.cast[0]!.model = "ghost";
    const problems = issuesOf(world);
    expect(problems).toContain('"nothing" is not a surface');
    expect(problems).toContain('"ghost" is not a model');
    expect(problems).toContain('played by "ghost"');
  });

  it("wants the points a lathe, extrude or tube is made from", () => {
    const world = testWorld();
    world.models[1]!.parts[0]!.shape = "lathe";
    expect(issuesOf(world)).toContain("a lathe needs `profile`");
  });

  it("only takes library models and materials that exist", () => {
    const world = testWorld();
    world.models[1]!.parts[0]!.shape = "asset";
    (world.models[1]!.parts[0] as { asset?: string }).asset = "no_such_model";
    (world.models[1]!.surfaces.skin as { material?: string }).material = "no_such_texture";
    const problems = issuesOf(world);
    expect(problems).toContain('"no_such_model" is not in the asset library');
    expect(problems).toContain('"no_such_texture" is not a library material');
  });

  it("wants the library id an asset part fits", () => {
    const world = testWorld();
    world.models[1]!.parts[0]!.shape = "asset";
    expect(issuesOf(world)).toContain("an asset needs `asset`");
  });

  it("takes a described character without parts or joints", () => {
    const world = testWorld();
    world.models[0] = { id: world.models[0]!.id, rig: "humanoid", height: 1.7, character: { skin: "#d9a98a", hair: { style: "short", colour: "#222222" }, top: { kind: "shirt", colour: "#3366aa" }, bottom: { kind: "trousers", colour: "#333333" } } } as never;
    expect(checkWorld(parse(world))).toEqual([]);
  });

  it("refuses numbers out of range and anything that isn't a colour", () => {
    const world = testWorld();
    world.models[1]!.surfaces.skin!.colour = "url(http://example.com)";
    expect(World.safeParse(world).success).toBe(false);
  });
});

describe("the world as a catalog", () => {
  const world = parse(testWorld());
  const own = worldCatalog(catalog, world);

  it("replaces the kit: only this story's cast and places", () => {
    expect(own.characters.map((character) => character.id)).toEqual(["hero"]);
    expect(own.backgrounds.map((background) => background.id)).toEqual(["harbour"]);
    expect(own.backgrounds[0]!.stage!.places.map((place) => place.id)).toEqual(["dock"]);
  });

  it("offers built-in moves to humanoids and only a model's own to anything else", () => {
    const things = own.backgrounds[0]!.stage!.things!;
    expect(things.find((thing) => thing.id === "hero")!.moves.map((move) => move.name)).toContain("walk");
    expect(things.find((thing) => thing.id === "crate")!.moves.map((move) => move.name)).toEqual(["rattle"]);
  });

  it("sends a shot only the models it uses", () => {
    const shot = worldForShot(world, { background: { id: "harbour", parallax: true }, stage: { camera: "wide", place: "dock", subject: "hero", leadStart: 0, leadEnd: 0, players: [{ id: "hero", model: "hero", at: [0, 0, 0], facing: 0, actions: [] }] } });
    expect(shot!.models.map((model) => model.id)).toEqual(["hero"]);
  });

  const shot = { id: "s01", start: 0, end: 3, lineIds: ["l01"], intent: "He looks out", characters: ["hero"], location: "harbour" };
  const brief: SceneBrief = { shot, durationFrames: 90, words: [{ text: "Out", startFrame: 0, endFrame: 20 }] };
  const bible = { cast: [{ id: "hero", kitCharacterId: "hero", description: "" }], style: { palette: [], captionStyle: "", mood: "", grade: "none" }, narrator: { voiceId: "v", backend: "b", language: "en" } };

  it("keeps the cast in a fallback shot, and the fallback passes the checks", () => {
    const scene = fallbackScene(brief, own, bible);
    expect(scene.stage).toMatchObject({ camera: "wide", place: "dock", subject: "hero" });
    expect(scene.stage!.players.map((player) => player.model)).toEqual(["hero"]);
    expect(validateScene({ ...scene, fallback: false }, { brief, bible, catalog: own })).toEqual([]);
  });

  it("takes a player's model id as the subject, since the AI uses both", () => {
    const world2 = parse({ ...testWorld(), cast: [{ id: "hero-old", model: "hero", description: "" }] });
    const catalog2 = worldCatalog(catalog, world2);
    const brief2 = { ...brief, shot: { ...shot, characters: ["hero-old"] } };
    const scene = fallbackScene(brief2, catalog2, { ...bible, cast: [{ id: "hero-old", kitCharacterId: "hero", description: "" }] });
    const named = { ...scene, fallback: false, stage: { ...scene.stage!, subject: "hero" } };
    expect(validateScene(named, { brief: brief2, bible, catalog: catalog2 })).toEqual([]);
    const wrong = { ...named, stage: { ...named.stage, subject: "nobody" } };
    expect(validateScene(wrong, { brief: brief2, bible, catalog: catalog2 }).map((issue) => issue.path)).toContain("stage.subject");
  });

  it("lets a shot with none of the cast in it follow a thing", () => {
    const empty = { ...brief, shot: { ...shot, characters: [] } };
    const crate = { id: "crate", model: "crate", at: [0, 0, 0] as [number, number, number], facing: 0, actions: [] };
    const scene = { ...fallbackScene(empty, own, bible), fallback: false };
    const onCrate = { ...scene, stage: { ...scene.stage!, subject: "crate", players: [crate] } };
    expect(validateScene(onCrate, { brief: empty, bible, catalog: own })).toEqual([]);
    // Still only something that is in the shot.
    const elsewhere = { ...onCrate, stage: { ...onCrate.stage, players: [] } };
    expect(validateScene(elsewhere, { brief: empty, bible, catalog: own }).map((issue) => issue.path)).toContain("stage.subject");
  });
});

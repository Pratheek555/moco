// The character designer: every description it accepts must come out as a sound humanoid.
import { describe, expect, it } from "vitest";
import { CHARACTER_BOTTOMS, CHARACTER_BUILDS, CHARACTER_EXTRAS, CHARACTER_HAIR, CHARACTER_HATS, CHARACTER_TOPS, WorldModel } from "@moco/spec";
import { HUMANOID_JOINTS } from "../src/stages/world/options.ts";
import { designCharacter, expandModel } from "../src/stages/world/character.ts";

const described = (overrides: Record<string, unknown> = {}) =>
  WorldModel.parse({
    id: "hero",
    rig: "humanoid",
    height: 1.7,
    character: { build: "average", skin: "#d9a98a", hair: { style: "short", colour: "#3a2a20" }, top: { kind: "shirt", colour: "#3366aa" }, bottom: { kind: "trousers", colour: "#333333" }, ...overrides },
  });

function problems(model: WorldModel): string[] {
  const built = designCharacter(model);
  const ids = built.parts.map((part) => part.id);
  const found: string[] = [];
  if (!WorldModel.safeParse(built).success) found.push(`schema: ${JSON.stringify(WorldModel.safeParse(built).error?.issues.slice(0, 2))}`);
  for (const joint of HUMANOID_JOINTS) if (!ids.includes(joint)) found.push(`missing joint ${joint}`);
  for (const id of ids.filter((id, index) => ids.indexOf(id) !== index)) found.push(`duplicate ${id}`);
  for (const part of built.parts) {
    if (part.parent && !ids.includes(part.parent)) found.push(`${part.id}: no parent ${part.parent}`);
    if (!(part.surface in built.surfaces)) found.push(`${part.id}: no surface ${part.surface}`);
    if (part.size.some((value) => !Number.isFinite(value))) found.push(`${part.id}: bad size`);
  }
  return found;
}

describe("designCharacter", () => {
  it("builds every build, hair style, top, bottom and hat into a sound humanoid", () => {
    const found = [
      ...CHARACTER_BUILDS.map((build) => problems(described({ build }))),
      ...CHARACTER_HAIR.map((style) => problems(described({ hair: { style, colour: "#222222" } }))),
      ...CHARACTER_TOPS.map((kind) => problems(described({ top: { kind, colour: "#aa3333" } }))),
      ...CHARACTER_BOTTOMS.map((kind) => problems(described({ bottom: { kind, colour: "#333399" } }))),
      ...CHARACTER_HATS.map((kind) => problems(described({ hat: { kind, colour: "#555555" } }))),
      ...[0, 5, 10].map((start) => problems(described({ extras: CHARACTER_EXTRAS.slice(start, start + 5).map((kind) => ({ kind })) }))),
      ...[0, 5, 10].map((start) => problems(described({ extras: CHARACTER_EXTRAS.slice(start, start + 5).map((kind) => ({ kind, colour: "#cc9900" })) }))),
    ].flat();
    expect(found).toEqual([]);
  });

  it("scales with height and keeps the feet on the ground", () => {
    const small = designCharacter({ ...described(), height: 1 });
    const tall = designCharacter({ ...described(), height: 2 });
    const hips = (model: WorldModel) => model.parts.find((part) => part.id === "hips")!.at[1];
    expect(hips(tall) / hips(small)).toBeCloseTo(2);
  });

  it("is a humanoid whatever rig was written, and keeps parts the AI added on top", () => {
    const model = WorldModel.parse({ ...described(), rig: "none", parts: [{ id: "staff", parent: "forearm_R", shape: "cylinder", size: [0.03, 1.4, 0.03], surface: "wood" }], surfaces: { wood: { colour: "#6b4a32" } } });
    const built = designCharacter(model);
    expect(built.rig).toBe("humanoid");
    expect(built.parts.find((part) => part.id === "staff")?.parent).toBe("forearm_R");
    expect(built.surfaces.wood?.colour).toBe("#6b4a32");
  });

  it("builds a model once, and leaves a model without a character alone", () => {
    const model = described();
    expect(expandModel(model)).toBe(expandModel(model));
    const plain = WorldModel.parse({ id: "rock", height: 1, surfaces: { s: { colour: "#777777" } }, parts: [{ id: "a", shape: "sphere", size: [1, 1, 1], surface: "s" }] });
    expect(expandModel(plain)).toBe(plain);
  });
});

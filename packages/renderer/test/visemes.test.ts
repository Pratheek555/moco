// The lip-sync track comes from the audio package; the mouths that show it come from the kit. Every shape the
// track can contain must be drawn by every character that has mouth shapes (others keep their expression mouth).
import { expect, it } from "vitest";
import { AMPLITUDE_VISEMES } from "@moco/audio";
import { catalog } from "@moco/kit";

const speaking = catalog.characters.filter((character) => character.visemes.length > 0);

it.each(speaking.map((character) => [character.id, character.visemes] as const))("%s draws every lip-sync shape", (_id, visemes) => {
  expect(AMPLITUDE_VISEMES.filter((viseme) => !visemes.includes(viseme))).toEqual([]);
});

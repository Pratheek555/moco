import { expect, it } from "vitest";
import { atPeak, textIds } from "../src/supertonic.ts";

// An identity table up to U+2FFF: each character's id is its own code.
const indexer = Array.from({ length: 0x3000 }, (_, code) => code);
const spoken = (ids: number[]) => String.fromCharCode(...ids);

it("wraps the text in its language tag, ends it, and plains its punctuation", () => {
  expect(spoken(textIds("It’s  lap one — go", "en", indexer))).toBe("<en>It's lap one - go.</en>");
  expect(spoken(textIds("Go!", "en", indexer))).toBe("<en>Go!</en>");
});

it("scales the reel to one peak and leaves silence alone", () => {
  const loud = atPeak({ sampleRate: 100, samples: Float32Array.of(0.1, -0.2) }, 0.8);
  expect(Array.from(loud.samples).map((sample) => Number(sample.toFixed(3)))).toEqual([0.4, -0.8]);
  expect(atPeak({ sampleRate: 100, samples: Float32Array.of(0, 0) }).samples).toEqual(Float32Array.of(0, 0));
});

it("drops characters the model has no id for", () => {
  const withoutQ = indexer.map((id, code) => (code === "q".charCodeAt(0) ? -1 : id));
  expect(spoken(textIds("aqb", "en", withoutQ))).toBe("<en>ab.</en>");
});

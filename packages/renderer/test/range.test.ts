// Byte ranges for the voiceover server: Chrome's media player asks for ranges, and getting them wrong makes it
// re-download the file until the browser crashes on long renders (see serveFile in src/index.ts).
import { expect, it } from "vitest";
import { parseRange } from "../src/index.ts";

it.each([
  [undefined, undefined],
  ["bytes=0-99", { start: 0, end: 99 }],
  ["bytes=100-", { start: 100, end: 999 }],
  ["bytes=-50", { start: 950, end: 999 }],
  ["bytes=900-5000", { start: 900, end: 999 }],
  ["bytes=1000-", "invalid"],
  ["bytes=-", "invalid"],
  ["items=0-1", "invalid"],
])("%s of a 1000-byte file → %o", (header, expected) => {
  expect(parseRange(header, 1000)).toEqual(expected);
});

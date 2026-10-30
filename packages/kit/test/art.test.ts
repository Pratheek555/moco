import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ArtError, MissingLayerError, parseCharacterArt } from "../src/art/load.ts";
import art from "../src/characters/krishna.art.json" with { type: "json" };

const krishnaSvg = readFileSync(new URL("../art/krishna/front.svg", import.meta.url), "utf8");

describe("art loader", () => {
  it("krishna.art.json matches art/krishna/front.svg (run `pnpm --filter @moco/kit catalog` if not)", () => {
    expect(art.front).toEqual(parseCharacterArt(krishnaSvg, "front.svg"));
  });

  it("reads layers without their ids, variant overrides, empty layers and pivots", () => {
    const parsed = parseCharacterArt(krishnaSvg, "front.svg");
    expect(parsed.layers.nose).toContain("<path");
    expect(parsed.layers.nose).not.toContain('id="nose"');
    expect(parsed.layers["garment_upper--charioteer"]).toContain("#c0392b");
    expect(parsed.layers["prop_waist--charioteer"]).toBe("");
    expect(parsed.pivots.neck).toEqual({ x: 200, y: 240 });
  });

  it("names every missing layer and pivot in a typed error", () => {
    const broken = krishnaSvg.replace('<g id="eyelid_L">', '<g id="lid_left">').replace(/<circle id="pivot_neck"[^>]*\/>/, "");
    const error = catchError(() => parseCharacterArt(broken, "front.svg"));
    expect(error).toBeInstanceOf(MissingLayerError);
    expect((error as MissingLayerError).missing).toEqual(["eyelid_L", "pivot_neck"]);
  });

  it("refuses nested layers, unsafe or slow SVG, orphan overrides and the wrong canvas", () => {
    const cases = [
      krishnaSvg.replace('<g id="nose">', '<g id="nose"><g id="face_marks"/>'),
      krishnaSvg.replace("</svg>", "<script>alert(1)</script></svg>"),
      krishnaSvg.replace("</svg>", '<filter id="blur"/></svg>'),
      krishnaSvg.replace('<g id="legs">', '<g id="legs" style="filter: blur(4px)">'),
      krishnaSvg.replace('<g id="hair_back">', '<g id="hair_front--charioteer"/><g id="hair_back">'),
      krishnaSvg.replace('viewBox="0 0 400 800"', 'viewBox="0 0 800 800"'),
    ];
    const errors = cases.map((svg) => catchError(() => parseCharacterArt(svg, "front.svg")));
    expect(errors.every((error) => error instanceof ArtError && !(error instanceof MissingLayerError))).toBe(true);
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

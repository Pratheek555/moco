import { describe, expect, it } from "vitest";
import { PublishThumbnail, ThumbnailChoice, thumbnailPresentation, THUMBNAIL_STYLES } from "../src/index.ts";

describe("thumbnail contract", () => {
  it("reads existing kits without requiring a design", () => {
    const old = { shotId: "s01", frame: 12, text: "A choice", file: "thumbnail.jpg" };
    expect(PublishThumbnail.parse(old)).toEqual(old);
  });
  it("counts Unicode characters consistently and trims a choice before validating", () => {
    expect(ThumbnailChoice.parse({ shotId: "s01", text: `  ${"😀".repeat(40)}  ` }).text).toBe("😀".repeat(40));
    expect(ThumbnailChoice.safeParse({ shotId: "s01", text: "😀".repeat(41) }).success).toBe(false);
  });
  it.each(THUMBNAIL_STYLES)("keeps $id headlines inside portrait and landscape frames", ({ id }) => {
    for (const [width, height] of [[1080, 1920], [1920, 1080], [640, 360]] as const) {
      for (const position of ["upper", "center", "lower"] as const) {
        const presentation = thumbnailPresentation(width, height, "A meaningful turning point", { style: id, position, accent: "mint" });
        expect(presentation.headline.left + presentation.headline.width).toBeLessThan(width);
        expect(presentation.headline.top + presentation.headline.fontSize * 2.16).toBeLessThan(height);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { dependencyStamp } from "../src/index.ts";

describe("bundle cache", () => {
  it("is keyed on the folders the 3D and React packages resolve to, so a reinstall can't mix two copies", () => {
    const stamp = dependencyStamp();
    // pnpm puts the peer-dependency hash in the folder name: a re-resolved @react-three/fiber changes the stamp.
    expect(stamp).toMatch(/@react-three\+fiber@[^|]+node_modules[\\/]@react-three[\\/]fiber/);
    expect(stamp).toContain("three@");
  });
});

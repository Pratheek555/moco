import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ArtifactStore } from "../src/store/artifacts.ts";
import { hashData } from "../src/store/hash.ts";
import { Ledger } from "../src/store/ledger.ts";

const golden = JSON.parse(readFileSync(new URL("../src/generator/examples/krishna-chariot.json", import.meta.url), "utf8"));

// The migration for additive spec changes: a spec stored under 0.1.0 (no actor.idle) is not mistaken for an
// outside edit, and reading it fills the new field's default.
it("reads a SceneSpec stored under spec 0.1.0 and upgrades it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-store-"));
  const ledger = await Ledger.load(dir);
  const store = new ArtifactStore(dir, ledger, () => {});

  const old = structuredClone(golden);
  old.actors.forEach((actor: Record<string, unknown>) => delete actor.idle);
  await writeFile(join(dir, "shot.json"), JSON.stringify({ meta: { kind: "SceneSpec", specVersion: "0.1.0" }, data: old }));
  ledger.data.artifacts["shot.json"] = { kind: "SceneSpec", revision: 0, contentHash: hashData(old) };

  const read = await store.read("shot.json", "SceneSpec");
  expect(read.meta.specVersion).toBe("0.1.0");
  expect(read.data.actors.every((actor) => actor.idle)).toBe(true);

  // An actual outside edit is still caught.
  old.shotId = "edited";
  await writeFile(join(dir, "shot.json"), JSON.stringify({ meta: { kind: "SceneSpec", specVersion: "0.1.0" }, data: old }));
  await expect(store.read("shot.json", "SceneSpec")).rejects.toThrow(/changed outside moco/);
});

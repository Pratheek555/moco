// Save and read artifacts as { meta, data } envelopes, with validation, history and a tamper check.
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactSchemas, SPEC_VERSION, type ArtifactData, type ArtifactKind, type InputRef, type Meta } from "@moco/spec";
import { EngineError } from "../errors.ts";
import { hashData } from "./hash.ts";
import type { Ledger } from "./ledger.ts";
import { exists, readJson, writeJsonAtomic } from "./workspace.ts";

export interface SaveOptions {
  producedBy: Meta["producedBy"];
  backend?: string;
  inputs?: InputRef[];
}

export interface Saved<K extends ArtifactKind> {
  meta: Meta;
  data: ArtifactData<K>;
  changed: boolean; // false when the new content hash equals the previous one
}

export class ArtifactStore {
  private readonly dir: string; // the series folder
  private readonly ledger: Ledger;
  private readonly onExternalChange: (file: string) => void;

  constructor(dir: string, ledger: Ledger, onExternalChange: (file: string) => void) {
    this.dir = dir;
    this.ledger = ledger;
    this.onExternalChange = onExternalChange;
  }

  // Validate, copy the old revision into history/, write atomically, record the hash.
  async save<K extends ArtifactKind>(file: string, kind: K, data: unknown, options: SaveOptions): Promise<Saved<K>> {
    // Schema check here too, so nothing invalid reaches disk even if a caller skipped validation.
    const parsed = ArtifactSchemas[kind].safeParse(data);
    if (!parsed.success) {
      throw new EngineError("validation_failed", `${kind} failed schema validation: ${parsed.error.message}`);
    }
    const clean = parsed.data as ArtifactData<K>;
    const contentHash = hashData(clean);
    const previous = this.ledger.data.artifacts[file];
    const fullPath = join(this.dir, file);

    if (previous && (await exists(fullPath))) {
      await mkdir(join(this.dir, "history"), { recursive: true });
      await copyFile(fullPath, join(this.dir, "history", historyName(file, previous.revision)));
    }

    const meta: Meta = {
      kind,
      specVersion: SPEC_VERSION,
      revision: previous ? previous.revision + 1 : 0,
      createdAt: new Date().toISOString(),
      producedBy: options.producedBy,
      backend: options.backend,
      inputs: options.inputs ?? [],
      contentHash,
    };
    await writeJsonAtomic(fullPath, { meta, data: clean });
    this.ledger.data.artifacts[file] = { kind, revision: meta.revision, contentHash };
    await this.ledger.save();

    return { meta, data: clean, changed: previous?.contentHash !== contentHash };
  }

  // Read and re-validate. If the stored data no longer matches the ledger hash, it was edited outside the engine.
  // The hash is checked on the data as stored, before parsing, so a file written under an older spec version
  // still matches: parsing then upgrades it (new fields get their defaults), which is the migration for
  // additive spec changes.
  async read<K extends ArtifactKind>(file: string, kind: K): Promise<{ meta: Meta; data: ArtifactData<K> }> {
    const record = this.ledger.data.artifacts[file];
    if (!record) throw new EngineError("not_found", `artifact ${file} does not exist`);

    const envelope = await readJson<{ meta: Meta; data: unknown }>(join(this.dir, file));
    const parsed = ArtifactSchemas[kind].safeParse(envelope.data);
    if (!parsed.success || hashData(envelope.data) !== record.contentHash) {
      this.onExternalChange(file);
      throw new EngineError("modified_externally", `${file} was changed outside moco. Restore a revision to continue.`);
    }
    return { meta: envelope.meta, data: parsed.data as ArtifactData<K> };
  }

  has(file: string): boolean {
    return this.ledger.data.artifacts[file] !== undefined;
  }

  hashOf(file: string): string | undefined {
    return this.ledger.data.artifacts[file]?.contentHash;
  }

  // Input reference for staleness tracking.
  inputRef(file: string): InputRef {
    const record = this.ledger.data.artifacts[file];
    if (!record) throw new EngineError("not_found", `artifact ${file} does not exist`);
    return { kind: record.kind, revision: record.revision, contentHash: record.contentHash };
  }

  // Revisions kept in history/, oldest first, plus the current one.
  async history(file: string): Promise<{ revision: number; current: boolean }[]> {
    const record = this.ledger.data.artifacts[file];
    if (!record) throw new EngineError("not_found", `artifact ${file} does not exist`);
    const prefix = historyName(file, 0).replace(/0\.json$/, "");
    const names = (await exists(join(this.dir, "history"))) ? await readdir(join(this.dir, "history")) : [];
    const old = names
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ revision: Number(name.slice(prefix.length, -".json".length)), current: false }))
      .sort((a, b) => a.revision - b.revision);
    return [...old, { revision: record.revision, current: true }];
  }

  // Data of an old revision (from history/, or the current file).
  async readRevision(file: string, revision: number): Promise<unknown> {
    const record = this.ledger.data.artifacts[file];
    if (record?.revision === revision) return (await readJson<{ data: unknown }>(join(this.dir, file))).data;
    const path = join(this.dir, "history", historyName(file, revision));
    if (!(await exists(path))) throw new EngineError("not_found", `revision ${revision} of ${file} not found`);
    return (await readJson<{ data: unknown }>(path)).data;
  }

  // Raw AI attempts are stored as-is (they may be invalid): the dataset for tuning prompts and the kit.
  async writeRaw(file: string, value: unknown): Promise<void> {
    await writeJsonAtomic(join(this.dir, file), value);
  }
}

// "episodes/ep-01/artifacts/script.json", rev 2 → "episodes__ep-01__artifacts__script.r2.json"
function historyName(file: string, revision: number): string {
  return `${file.replaceAll("/", "__").replace(/\.json$/, "")}.r${revision}.json`;
}

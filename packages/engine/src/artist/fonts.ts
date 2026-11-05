import { readFile } from "node:fs/promises";

// Licensed fonts bundled offline. Embed only requested families so saved artwork
// renders identically on another machine, without browser network access.
export async function canvasFonts(brief: string): Promise<Record<string, string>> {
  const found: Record<string,string> = {};
  for (const [pattern, family, file] of [
    [/lilita\s*one/i, "Lilita One", "LilitaOne-Regular.ttf"],
    [/montserrat/i, "Montserrat", "Montserrat.ttf"],
  ] as const) {
    if (pattern.test(brief)) found[family] = `data:font/ttf;base64,${(await readFile(new URL(`../../assets/fonts/${file}`,import.meta.url))).toString("base64")}`;
  }
  return found;
}

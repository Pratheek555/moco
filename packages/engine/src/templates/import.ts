import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ArtistProduction } from "@moco/spec";
import type { TemplateInfo } from "./index.ts";

export interface PromptTemplateInput {
  name: string;
  prompt: string;
  referenceImages?: string[]; // data:image/{png,jpeg,webp};base64,...
  production: NonNullable<TemplateInfo["production"]>;
}

// A prompt is data, never executed during import. Explicit settings avoid guessing
// a renderer or aspect ratio from negated examples buried in long instructions.
export async function importPromptTemplate(dir: string, input: PromptTemplateInput): Promise<TemplateInfo> {
  const name = input.name.trim(), prompt = input.prompt.trim();
  if (!name || name.length > 120 || !prompt || prompt.length > 64000) throw Error("Supply a name (1-120 characters) and prompt (1-64000 characters)");
  const production = ArtistProduction.parse(input.production);
  const images = input.referenceImages ?? [];
  if (images.length > 5 || images.some(image => image.length > 4_000_064 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) throw Error("Use up to five PNG, JPEG or WebP style frames, each under 3 MB");
  for(const image of images) {
    const bytes=Buffer.from(image.slice(image.indexOf(",")+1),"base64");
    if(bytes.length>3_000_000) throw Error("Style frames must be under 3 MB");
    const valid=image.startsWith("data:image/png") ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : image.startsWith("data:image/jpeg") ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
    if(!valid) throw Error("Style frame data does not match its image type");
  }
  const referenceImages = images.map((image,index) => `references/${index}.${image.slice(11,image.indexOf(";"))}`);
  const id = `prompt-${randomUUID()}`;
  const info: TemplateInfo = {
    id, name, tagline: "Your prompt, custom canvas artwork and local narration",
    description: prompt.slice(0, 300), creativePrompt: prompt, production, tags: ["Prompt", "2D"],
    story: ["Review script and estimated shot plan before narration"],
    look: [`${production.format.width} × ${production.format.height} at ${production.format.fps} fps`, "Custom illustrated scenes"],
    palette: { sky: ["#536c9b", "#d7d8e7"], ground: "#3e5261", accents: ["#e5b882", "#bd8ca8"] },
    world: "auto", defaults: { episodes: 1 }, ideas: [], referenceImages,
  };
  await mkdir(dir, { recursive: true });
  const staging = join(dir, `.${id}`), destination = join(dir, id);
  await mkdir(staging);
  try {
    if(images.length) await mkdir(join(staging,"references"));
    for(const [index,image] of images.entries()) await writeFile(join(staging,referenceImages[index]!),Buffer.from(image.slice(image.indexOf(",")+1),"base64"));
    await writeFile(join(staging, "moco-template.json"), JSON.stringify(info, null, 2));
    await writeFile(join(staging, "moco-template.md"), `# Creative prompt\n${prompt}\n`);
    await rename(staging, destination);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  return info;
}

process.on("unhandledRejection", (e) => console.log("UNHANDLED", (e as Error).message));
import { readFileSync } from "node:fs";
import { createRemotionRenderPort } from "@moco/renderer";
const spec = JSON.parse(readFileSync(process.argv[2]!, "utf8")).data;
const render = createRemotionRenderPort({});
const out = await render.check(spec, { frames: [0], outDir: process.argv[3]! });
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
await render.close();

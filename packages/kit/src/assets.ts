// @moco/kit/assets — where the kit's baked images live on disk. The renderer serves this folder as Remotion's
// public dir, so a kit path like "atmosphere/mist.png" is staticFile("atmosphere/mist.png").
import { fileURLToPath } from "node:url";

export const KIT_ASSETS_DIR = fileURLToPath(new URL("../assets/", import.meta.url));

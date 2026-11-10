import { createRemotionRenderPort, type RemotionRenderOptions } from "./index.ts";
import { createBlenderRenderPort, type BlenderRenderOptions } from "./blender/index.ts";

// Route by saved scene data, not today's preference. Existing projects remain playable.
export function createMocoRenderPort(options: {
  backend?: "remotion" | "blender"; blender?: BlenderRenderOptions; remotion?: RemotionRenderOptions;
} = {}) {
  const remotion = createRemotionRenderPort(options.remotion);
  const blender = createBlenderRenderPort(options.blender);
  return {
    sceneBackend: options.backend,
    check: (...args: Parameters<typeof remotion.check>) => (args[0].blender ? blender : remotion).check(...args),
    thumbnail: (...args: Parameters<typeof remotion.thumbnail>) => (args[0].blender ? blender : remotion).thumbnail(...args),
    renderEpisode: (...args: Parameters<typeof remotion.renderEpisode>) => {
      const count = args[0].scenes.filter(scene => scene.blender).length;
      if (count && count !== args[0].scenes.length) throw new Error("An episode cannot mix Blender and Remotion shots. Regenerate all shots using the project's renderer.");
      return (count ? blender : remotion).renderEpisode(...args);
    },
    versions: () => ({ kitVersion: remotion.versions().kitVersion, rendererVersion: `${remotion.versions().rendererVersion}+${blender.versions().rendererVersion}` }),
    async release() { await Promise.all([remotion.release(), blender.release()]); },
    async close() { await Promise.all([remotion.close(), blender.close()]); },
  };
}

// Pre-bundles the Remotion project so the desktop app can render without webpack at runtime.
import { bundle } from '@remotion/bundler';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
const started = Date.now();
const result = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  outDir,
  onProgress: (p) => {
    if (p % 25 === 0) process.stdout.write(`bundling ${p}%\n`);
  },
});
console.log(`bundled → ${result} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

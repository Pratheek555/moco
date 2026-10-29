// Dev helper: render one frame of a composition from the prebuilt bundle.
// node scripts/still.ts <compositionId> <frame> <out.png> '<json props>'
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id = 'Sheet', frame = '0', out = 'still.png', json = '{}'] = process.argv.slice(2);
const serveUrl = path.join(root, 'build');
const inputProps = JSON.parse(json);
await ensureBrowser();
const composition = await selectComposition({ serveUrl, id, inputProps });
await renderStill({ composition, serveUrl, output: path.resolve(out), frame: Number(frame), inputProps, scale: Number(process.env.SCALE ?? 0.5) });
console.log('wrote', out);

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript source, so they're bundled rather than
// treated as external node_modules.
const workspace = ['@moco/ai', '@moco/audio', '@moco/engine', '@moco/kit', '@moco/spec', '@moco/renderer'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspace },
      rolldownOptions: {
        input: { index: 'src/main/index.ts', 'render-worker': 'src/main/render-worker.ts' },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: 'src/preload/index.ts' },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    optimizeDeps: { exclude: workspace },
  },
});

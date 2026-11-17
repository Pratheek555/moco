import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Coding tools sometimes inherit Electron's Node-only mode. Dev must start the desktop runtime.
delete process.env.ELECTRON_RUN_AS_NODE;

// Workspace packages are TypeScript source, so they're bundled rather than
// treated as external node_modules.
const workspace = ['@moco/agent'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspace },
      // agent-host.ts runs from source in a utility process.
      rolldownOptions: { input: { index: 'src/main/index.ts' } },
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
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    optimizeDeps: { exclude: workspace },
  },
});

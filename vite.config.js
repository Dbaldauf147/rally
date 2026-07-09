import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const buildId = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-build-id',
      // Capture the resolved root + output dir so the sw.js stamp finds the file.
      configResolved(cfg) { this._root = cfg.root; this._outDir = cfg.build.outDir; },
      // Stamp the build id into index.html (drives the update banner).
      transformIndexHtml(html) {
        return html.replace('__BUILD_ID__', buildId);
      },
      // After dist/ is written (public/ files already copied), stamp the same
      // build id into the service worker's cache name so each deploy invalidates
      // the previous cache automatically.
      closeBundle() {
        try {
          const swPath = resolve(this._root || '.', this._outDir || 'dist', 'sw.js');
          const src = readFileSync(swPath, 'utf8');
          if (src.includes('__BUILD_ID__')) {
            writeFileSync(swPath, src.replaceAll('__BUILD_ID__', buildId));
          }
        } catch (err) {
          console.warn(`Could not stamp build id into sw.js: ${err.message}`);
        }
      },
    },
  ],
})

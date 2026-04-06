import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const buildId = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-build-id',
      transformIndexHtml(html) {
        return html.replace('__BUILD_ID__', buildId);
      },
    },
  ],
})

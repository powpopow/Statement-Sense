import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves a project site from /<repo>/, so the asset base has to
// match. The deploy workflow sets BASE_PATH; local dev and user/org pages
// fall back to the root.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // The OCR and PDF engines are large and only some users load both, so keep
    // them out of the main bundle rather than raising the warning limit.
    chunkSizeWarningLimit: 900,
  },
  optimizeDeps: {
    // tesseract.js ships CommonJS internals, so it has to go through Vite's
    // dependency pre-bundling — excluding it leaves bare `require` calls that
    // throw in the browser.
    include: ['tesseract.js'],
  },
})

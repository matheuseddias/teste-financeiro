import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@eddias/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname } },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// A separate build whose entry is this folder's index.html, so the smoke test
// loads the same modules the app ships rather than a reimplementation.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        design: path.join(__dirname, 'index.html'),
        psd: path.join(__dirname, 'psd.html'),
      },
    },
  },
});

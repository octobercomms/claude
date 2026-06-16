import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      // Coverage-entry PDF/scan attachments are served by the backend's
      // express.static; proxy them so they don't fall through to the SPA
      // (which would render a blank screen on an unknown route).
      '/coverage-attachments': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});

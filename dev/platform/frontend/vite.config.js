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
  // Keep function and class names through minification. Without this, esbuild
  // renames every component to a single letter, so a production React error
  // reports its component stack as "at t / at n / at r" and the daily error
  // digest is unreadable. Measured cost: +37 kB gzipped (615 -> 652 kB, ~6%),
  // paid once per cached build, in exchange for production errors that name
  // the component that actually failed.
  //
  // Deliberately NOT `build.sourcemap`: full source maps would publish the
  // frontend source next to the bundle, and the digest is read in an inbox
  // rather than a debugger, so names alone give nearly all the benefit at
  // none of the exposure.
  esbuild: {
    keepNames: true,
  },
  build: {
    outDir: 'dist',
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));

// The commit this bundle was built from, stamped in at build time and shown in
// the sidebar. Without it there is no way to tell from a browser which build is
// running, which on 21 Oct 2026 cost hours: three deploys landed on the box
// while the browser kept serving a cached index.html, and the only clue was a
// button that should have been there and was not.
//
// Falls back to 'dev' outside a git checkout so a build never fails over this.
function buildStamp() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(buildStamp()),
  },
  // The humanity analyser lives in dev/platform/shared so the editor and the
  // backend run the same code. It sits outside the Vite root, hence the alias
  // and the fs.allow.
  resolve: { alias: { '@shared': path.resolve(here, '../shared') } },
  server: {
    fs: { allow: [path.resolve(here, '..')] },
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

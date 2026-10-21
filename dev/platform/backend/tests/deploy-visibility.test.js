// Guard — a deploy actually reaches the browser, and you can tell which build
// you are looking at.
//
// On 21 Oct 2026 three deploys landed on the box, each verified green, and the
// browser kept running the old bundle for hours. The cause: nginx sent no
// Cache-Control on index.html, only ETag and Last-Modified, which a browser may
// reuse from its own cache without asking. index.html is the one file that
// names the content-hashed bundles, so a single stale copy pins a browser to an
// old build no matter how many times the server deploys.
//
// The only clue was a button that should have been there and was not. There was
// no way, from the browser, to tell which build was running — so the time went
// on chasing a backend bug that did not exist, while a user lost a recording.
//
// Two things stop that recurring, and this checks both.

const fs = require('fs');
const path = require('path');

const nginx = fs.readFileSync(
  path.join(__dirname, '..', '..', 'nginx', 'platform.conf'), 'utf8');
const vite = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'vite.config.js'), 'utf8');
const layout = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'Layout.jsx'), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// Pull a location block out by name, so a directive is only credited when it is
// inside the block it needs to be in. nginx does not inherit add_header into a
// location that sets its own, which is the trap the file already warns about.
function locationBlock(name) {
  const re = new RegExp(`location ${name.replace(/[/]/g, '\\/')} \\{([\\s\\S]*?)\\n    \\}`);
  const m = nginx.match(re);
  return m ? m[1] : null;
}

// --- index.html is never served from cache without asking -------------------
const root = locationBlock('/');
check('the SPA location block was found', !!root);
check('index.html is served no-cache',
  !!root && /add_header Cache-Control "no-cache"/.test(root),
  'without it a browser reuses its cached index.html, which names the OLD hashed bundles, and no number of deploys will dislodge it');

// The headers that were already there must survive beside the new one: nginx
// add_header is additive within a block, but a careless edit could drop them.
for (const h of ['Content-Security-Policy', 'X-Frame-Options', 'Strict-Transport-Security']) {
  check(`the SPA block still sets ${h}`, !!root && root.includes(h),
    'the cache header must not have displaced the security headers');
}

// --- hashed assets may be cached hard ---------------------------------------
const assets = locationBlock('/assets/');
check('hashed assets have their own block', !!assets,
  'without it they fall into location / and inherit no-cache, so every navigation refetches the whole bundle');
check('they are cached as immutable',
  !!assets && /immutable/.test(assets) && /expires 1y/.test(assets),
  'the filename carries a content hash, so the bytes behind it never change');
check('they still refuse MIME sniffing',
  !!assets && /X-Content-Type-Options nosniff/.test(assets),
  'a location that sets its own add_header inherits none, and this one matters for scripts');

// --- you can see which build you are running --------------------------------
check('the build is stamped at compile time',
  /__BUILD__/.test(vite) && /rev-parse --short HEAD/.test(vite),
  'without a stamp, "is my change live?" is unanswerable from the browser');
check('the stamp cannot fail a build',
  /catch \{[\s\S]{0,80}return 'dev'/.test(vite),
  'a build outside a git checkout must still succeed');
check('the stamp is rendered where it can be read',
  /__BUILD__/.test(layout) && /build \{/.test(layout),
  'a stamp nobody can see is not a stamp');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

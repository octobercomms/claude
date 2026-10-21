// Guard — a long screen recording can actually be saved.
//
// On 21 Oct 2026 a 30-minute walkthrough failed with a bare nginx 413 after it
// had already been filmed. Three ceilings were involved and none of them knew
// about the others:
//
//   1. nginx had no location block for /api/recordings/, so it inherited the
//      server-wide client_max_body_size of 128M. MediaRecorder produces around
//      0.38 MB/s, so 30 minutes is roughly 700MB. Refused at the door.
//   2. multer used memoryStorage() capped at 512MB, so even past nginx the file
//      was rejected — and anything under the cap was held whole in the box's
//      RAM, which means raising nginx alone would have turned a clean error
//      into an out-of-memory kill of the whole platform mid-upload.
//   3. The browser dropped nothing, but the only route to the recorded blob was
//      a hand-typed download in the DevTools console.
//
// So this checks the three in one place: the limits agree, the upload path
// streams rather than buffers, and the page offers the file back when a save
// fails. Static reads of the files involved; no database, no network, nothing
// to spin up.

const fs = require('fs');
const path = require('path');

// Strip comments before matching. Every one of these files now carries a
// comment explaining what it used to do wrong, and naming the old call in prose
// must not read as still making it — the first run of this test failed three
// checks for exactly that reason.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const read = (...p) => stripComments(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
// nginx keeps its comments: the directives are matched inside a located block,
// and the '#' comment syntax cannot be confused with one.
const nginx = fs.readFileSync(
  path.join(__dirname, '..', '..', 'nginx', 'platform.conf'), 'utf8');
const route = read('src', 'routes', 'recordings.js');
const store = read('src', 'services', 'mediaStore.js');
const pageRaw = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'RecordingsPage.jsx'), 'utf8');
const page = stripComments(pageRaw);

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// A 30-minute recording, the thing that has to fit.
const THIRTY_MIN_BYTES = 30 * 60 * 0.38 * 1024 * 1024; // ~700MB

// --- nginx ----------------------------------------------------------------
// Pull the /api/recordings/ block out of the config and read its own limits
// rather than trusting that one appears somewhere in the file.
const block = nginx.match(/location \/api\/recordings\/ \{([\s\S]*?)\n    \}/);
check('nginx has a location block for the recordings API', !!block,
  'without one it inherits the server-wide client_max_body_size and refuses anything over it');

if (block) {
  const body = block[1];
  const m = body.match(/client_max_body_size\s+(\d+)M/);
  const limitBytes = m ? Number(m[1]) * 1024 * 1024 : 0;
  check('it accepts a 30-minute recording', limitBytes >= THIRTY_MIN_BYTES,
    `limit is ${m ? m[1] + 'M' : 'unset'}, a 30-minute recording is about ${Math.round(THIRTY_MIN_BYTES / 1024 / 1024)}MB`);
  check('it streams the body through instead of spooling it first',
    /proxy_request_buffering\s+off/.test(body),
    'nginx would write the whole upload to its own temp file before the backend saw a byte');
  check('its timeouts survive a slow upload of that size',
    /client_body_timeout\s+(\d+)s/.test(body) && Number(body.match(/client_body_timeout\s+(\d+)s/)[1]) >= 600,
    'a 700MB upload on a domestic connection takes several minutes');
}

// The block has to win the match against the generic /api/ one. nginx picks the
// longest matching prefix, so this holds by construction, but the generic
// ceiling is worth pinning: if someone raises it to paper over a problem, the
// per-location limits stop being the thing under test.
const serverWide = nginx.match(/\n    client_max_body_size\s+(\d+)M/);
check('the server-wide ceiling is still modest',
  serverWide && Number(serverWide[1]) <= 256,
  'a large global limit means any endpoint can be handed a huge body by accident');

// --- the upload handler ---------------------------------------------------
check('uploads stream to disk rather than into memory',
  /multer\.diskStorage/.test(route) && !/memoryStorage/.test(route),
  'memoryStorage holds the entire recording in the box RAM; a few concurrent uploads take the platform down');

const maxM = route.match(/MAX_UPLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/);
check('the handler accepts a 30-minute recording too', !!maxM && Number(maxM[1]) * 1024 ** 3 >= THIRTY_MIN_BYTES,
  'a limit below nginx just moves the rejection and loses the clearer message');

check('the two limits agree', !!block && !!maxM
  && Number(block[1].match(/client_max_body_size\s+(\d+)M/)[1]) === Number(maxM[1]) * 1024,
  'nginx and multer must name the same ceiling, or one silently overrides the other');

check('the spooled file is handed over by path, not by buffer',
  /mediaStore\.saveFile\(/.test(route) && !/req\.file\.buffer/.test(route),
  'req.file.buffer is undefined under diskStorage and would write an empty file');

check('a failed or finished upload cleans up its temp file',
  /cleanupUpload/.test(route) && (route.match(/finally \{\s*await cleanupUpload/g) || []).length >= 2,
  'multer leaves the spooled file behind on every error path');

// --- the store ------------------------------------------------------------
check('the disk driver moves the file instead of copying it',
  /fs\.promises\.rename/.test(store), 'a rename is instant; a copy writes 700MB twice');
check('it still works when the temp dir is on another filesystem',
  /EXDEV/.test(store), 'rename fails across filesystems and would lose the recording');
check('the temp dir sits inside the store, so the rename is same-filesystem',
  /tmpDir\(\)/.test(store) && /path\.join\(DISK_DIR, 'tmp'\)/.test(store));
check('the R2 driver streams the upload with a declared length',
  /Body: fs\.createReadStream/.test(store) && /ContentLength/.test(store),
  'S3 needs a length on a single PUT, and reading the file in defeats the point');

// --- the browser side -----------------------------------------------------
// Target the save-failure handler itself rather than any catch in the file:
// the success path legitimately calls discard(), and so does the small
// clipboard catch beside it.
// Sliced by index rather than matched with one regex: a single pattern
// spanning a whole block is the kind that fails silently and reports the code
// as broken when the test is.
function saveFailureHandler(src) {
  const at = src.indexOf("'Save failed");
  if (at < 0) return null;
  const open = src.lastIndexOf('catch (err) {', at);
  if (open < 0) return null;
  const close = src.indexOf('\n    }', at);
  if (close < 0) return null;
  return src.slice(open, close);
}
const failHandler = saveFailureHandler(page);
check('the save-failure handler was found', !!failHandler,
  'the test cannot check what it cannot locate');
check('a failed save keeps the recording on the page',
  !!failHandler && !/discard\(\)/.test(failHandler) && /setPhase\('preview'\)/.test(failHandler),
  'discarding on failure is how a 30-minute recording gets destroyed by a 413');
check('the operator is told the recording is not lost',
  /not lost/i.test(pageRaw), 'the toast alone reads like the file is gone');
check('and can get the file out without the DevTools console',
  /function downloadLocal/.test(page) && /↓ Download/.test(pageRaw));
check('the download does not revoke the URL before the browser starts it',
  /setTimeout\(\(\) => URL\.revokeObjectURL/.test(page),
  'revoking immediately cancels the download in Chrome');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

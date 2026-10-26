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

// Drop comment LINES before matching, rather than comment spans.
//
// Every file here carries a comment explaining what it used to do wrong, and
// naming the old call in prose must not read as still making it. The first
// attempt at this used regexes for /* */ and trailing //, which ate across
// lines and silently destroyed most of each file: api.js came through at 28%
// of its length and mediaStore at 59%, so several checks were passing on
// whatever happened to survive. Splitting on lines cannot do that — a line is
// either dropped whole or kept whole.
//
// A trailing comment on a code line survives, which is fine: the assertions
// below are all code-shaped, and no comment in these files writes `xhr.open(`
// or `multer.diskStorage(`.
const codeOnly = (src) => src
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*'));
  })
  .join('\n');

const read = (...p) => codeOnly(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
// nginx keeps its comments: the directives are matched inside a located block,
// and the '#' comment syntax cannot be confused with one.
const nginx = fs.readFileSync(
  path.join(__dirname, '..', '..', 'nginx', 'platform.conf'), 'utf8');
const route = read('src', 'routes', 'recordings.js');
const store = read('src', 'services', 'mediaStore.js');
const pageRaw = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'RecordingsPage.jsx'), 'utf8');
const page = codeOnly(pageRaw);

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

// --- progress and rename ---------------------------------------------------
// fetch exposes no upload-progress event, so a 600MB recording sat behind a
// motionless "Uploading…" with no way to tell progress from a stall.
const api = read('..', 'frontend', 'src', 'utils', 'api.js');
check('there is an upload helper that reports progress',
  /postFormProgress/.test(api) && /upload\.onprogress/.test(api),
  'fetch cannot report upload progress; this needs XMLHttpRequest');
check('it still sends the session cookie',
  /withCredentials = true/.test(api),
  'without it every upload is a 401 and bounces to login');
check('it gives a 413 the same plain-English message as fetch does',
  /413[\s\S]{0,200}too large to upload/.test(api),
  'otherwise the one error this page is most likely to hit reads as a JSON parse failure');
check('both upload paths report progress',
  (page.match(/postFormProgress/g) || []).length >= 2,
  'the recorder save and the file import each need it');
check('progress is cleared when an upload ends',
  (page.match(/setUploadPct\(null\)/g) || []).length >= 3,
  'a stale percentage left on screen is worse than none');

check('a finished video can be renamed from the list',
  /function rename\(/.test(page) && />Rename</.test(pageRaw),
  'a title was only settable at save time, so a hurried or failed save kept the wrong name for good');
check('the rename endpoint exists and is ownership-checked',
  /router\.patch\('\/:id'/.test(route) && /created_by IS NOT DISTINCT FROM/.test(route));
check('it refuses an empty title',
  /if \(!title\) return res\.status\(400\)/.test(route),
  'blanking a title loses the only handle on the video');

// --- the recording cannot be lost ------------------------------------------
// The upload fixes above stop a save failing. These stop a recording being
// destroyed when something else goes wrong, which is what actually happened on
// 21 Oct: the upload was refused, the page later released the blob, and the
// only copy in existence went with it.

check('a copy is written to disk the moment recording stops',
  /rec\.onstop[\s\S]{0,600}keepLocalCopy[\s\S]{0,200}saveBlobToDisk/.test(page),
  'disk first, before a byte is sent: a file on disk cannot be taken away by a server limit, a cache or a page reset');
// Source order would prove nothing about execution order (and the first
// attempt at this matched `saveClients` instead of `save`). The property that
// matters is that the disk copy does not live inside the upload path, so no
// upload failure can skip it.
const saveBody = (() => {
  const at = page.indexOf('async function save() {');
  if (at < 0) return null;
  const end = page.indexOf('\n  }', at);
  return end < 0 ? null : page.slice(at, end);
})();
check('the save function was found', !!saveBody);
check('the disk copy does not depend on the upload succeeding',
  !!saveBody && !/saveBlobToDisk/.test(saveBody) && /postFormProgress/.test(saveBody),
  'a disk write reached only after a successful upload would not have helped on 21 Oct');
check('that preference defaults to on, including when storage is unreadable',
  /localStorage\.getItem\('omi\.recorder\.keepLocal'\) !== '0'/.test(page)
    && /catch \{ return true;/.test(page),
  'a private window or blocked storage must fail safe, not silently off');
check('the operator is told a copy exists, and where',
  /Saved to your Downloads as/.test(pageRaw));

check('leaving with an unsaved recording is challenged',
  /addEventListener\('beforeunload'/.test(page) && /returnValue/.test(page),
  'a reload took 30 minutes of filming with it and said nothing');
check('the guard is only armed while there is something to lose',
  /phase === 'preview' \|\| phase === 'saving'\) && !!blobRef\.current/.test(page),
  'warning on every navigation trains the operator to click through it');

check('the create step checks what came back before using it',
  /typeof created\.upload\.path !== 'string'/.test(page),
  'reading .path off undefined gives a TypeError naming neither the call nor the response');
check('and its message says the recording is safe',
  /Your recording is safe/.test(pageRaw),
  'the one thing the operator needs to know at that moment');

// --- the recording is usable, and does not freeze --------------------------

check('MP4 is recorded wherever the browser can',
  /'video\/mp4;codecs=avc1[^']*'/.test(page) && page.indexOf('video/mp4') < page.indexOf('video/webm;codecs=vp9'),
  'macOS cannot open WebM in QuickTime, Keynote or Final Cut, so every recording needed converting first');
check('the container is carried through, not assumed',
  !/'video\/webm'\s*\}\);/.test(page) && /baseMime\(mimeRef\.current\)/.test(page),
  'a hardcoded webm mime mislabels an MP4 recording to the store and the player');
check('the file extension follows the container',
  /extFor\(mimeRef\.current\)/.test(page),
  'an MP4 named .webm is a file macOS still refuses to open');
check('the store knows the MP4 extension',
  /'video\/mp4'\s*:\s*'mp4'/.test(store));

// The freeze. rAF does not fire while the tab is hidden, and a screen
// recording is exactly when the operator switches away. The canvas composite
// then stops being redrawn, captureStream emits nothing, and the microphone
// track runs on alone: video frozen, audio to the end.
// Target the call, not the name. The first version of this check matched the
// trailing comment on the `rvfcRef` declaration, so removing the actual call
// left it green — codeOnly keeps a code line whole, trailing comment included.
check('the camera composite is not driven by requestAnimationFrame alone',
  /screenVideo\.requestVideoFrameCallback\(draw\)/.test(page),
  'rAF stops in a hidden tab, which freezes the video and leaves the audio running');
check('rAF remains only as the fallback',
  /typeof screenVideo\.requestVideoFrameCallback === 'function'/.test(page)
    && /requestAnimationFrame\(draw\)/.test(page),
  'browsers without the frame callback still need a loop');
check('a stalled composite still emits frames',
  /keepAliveRef\.current = setInterval/.test(page) && /lastDrawRef/.test(page),
  'without a floor the captured track goes silent whenever frames stop arriving');
check('both loops are torn down when recording ends',
  /clearInterval\(keepAliveRef\.current\)/.test(page) && /cancelAnimationFrame\(rafRef\.current\)/.test(page),
  'a draw loop left running after stop keeps the camera and the CPU busy');

check('data is flushed during recording, not held to the end',
  /rec\.start\(5000\)/.test(page),
  'one unbroken buffer for a 30-minute capture is where frames get dropped under memory pressure');

// --- a create answered by a list ---------------------------------------------
//
// On 26 Oct 2026 a 9-minute recording failed to save with "the server did not
// return somewhere to upload to (keys: 0, 1, 2, 3)". Those are array indices:
// the create endpoint had been answered with a four-item array, and the only
// thing on that path returning a bare array is the recordings list. A POST
// comes back as a list when it has been redirected, because fetch follows
// 301/302/303 and the spec turns the method into GET and drops the body.
//
// Nothing recorded whether that is what happened, which is the actual defect:
// the failure could not be diagnosed after the fact. Both halves below exist
// so the next one names itself.
check('a redirected mutating request is named as one',
  /res\.redirected && !\['GET', 'HEAD'\]\.includes\(method\)/.test(api),
  'fetch turns a redirected POST into a GET and drops the body, silently');
check('and says nothing was saved',
  /Nothing was saved/.test(api),
  'the caller has to know whether to retry or whether it half-happened');
check('a create answered with a list says so in those words',
  /Array\.isArray\(created\)/.test(page) && /which is what the list endpoint returns/.test(page),
  '"keys: 0, 1, 2, 3" is a shape; it took reading the route to learn it meant a list');
check('and still points at the recording that is safe',
  /press Download to keep it/.test(page),
  'the file is on the page and nothing else matters until it is off it');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

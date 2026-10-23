// Guard — the design studio keeps the work, and does not grow a second of
// anything OMI already has.
//
// Built to replace Canva and Adobe Express for one specific job: layered social
// posts for a client. A full-bleed photo, a few text layers, logo lockups on
// top, then duplicate the page and swap the photo and the headline. There is
// deliberately no template library, because duplication covers the same ground
// with nothing to curate.
//
// The behaviour of the routes is covered by an integration run against a real
// Postgres (project → page → scene → duplicate → reorder → delete), which
// cannot run here because CI has no database. These are the structural
// properties that a later edit could quietly undo.

const fs = require('fs');
const path = require('path');

const codeOnly = (src) => src
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*') || t.startsWith('--'));
  })
  .join('\n');

const read = (...p) => codeOnly(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const route = read('src', 'routes', 'design.js');
const migration = read('migrations', '208_design_studio.sql');
const index = read('src', 'index.js');
const pageRaw = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ClientDesignPage.jsx'), 'utf8');
const page = codeOnly(pageRaw);
const tab = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ClientVideoTab.jsx'), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// --- it reuses what exists ---------------------------------------------------
check('the studio is mounted', /app\.use\('\/api\/design'/.test(index));
check('assets are not duplicated into a second store',
  !/CREATE TABLE[^;]*design_assets/.test(migration) && /brand\/clients\//.test(page),
  'brand_assets already stores a client\'s logos and images with upload and authenticated serving');
check('the asset list is read as the array that endpoint returns',
  /Array\.isArray\(r\) \? r :/.test(page),
  'routes/brandAssets.js answers with a bare array, not { items }');

// --- the work cannot be lost -------------------------------------------------
check('a new project is created with a page',
  /INSERT INTO design_pages \(project_id, sort_order\) VALUES \(\$1, 0\)/.test(route),
  'a project with no pages opens the editor onto nothing');
check('the last page cannot be deleted',
  /n <= 1\) return res\.status\(400\)/.test(route));
check('the editor autosaves', /setInterval\(\(\) => \{ if \(dirtyRef\.current\) save\(\)/.test(page));
check('and saves before switching page',
  /if \(dirtyRef\.current\) await save\(\);\n\s*setPageId/.test(page),
  'switching page reloads the canvas, which would discard unsaved edits');
check('leaving with unsaved changes is challenged',
  /addEventListener\('beforeunload'/.test(page) && /unsaved changes/i.test(pageRaw));

// --- duplication is the feature ---------------------------------------------
check('a page duplicates', /router\.post\('\/pages\/:id\/duplicate'/.test(route));
check('the copy lands next to its source, not at the end',
  /sort_order = sort_order \+ 1 WHERE project_id = \$1 AND sort_order > \$2/.test(route),
  'appending to the end loses the order the work was done in');
check('a whole project duplicates in one statement',
  /INSERT INTO design_pages[\s\S]{0,120}SELECT \$1, sort_order, scene, thumbnail FROM design_pages/.test(route),
  'a read-then-write loop over twenty pages is forty round trips and can half-finish');
check('both copies are transactional',
  (route.match(/ROLLBACK/g) || []).length >= 3,
  'a partial copy is worse than no copy');
check('there is no template library to keep in step',
  !/template/i.test(route) && !/CREATE TABLE[^;]*template/i.test(migration));

// --- the scene --------------------------------------------------------------
check('the scene is stored whole as JSONB',
  /scene\s+JSONB NOT NULL/.test(migration),
  'modelling Fabric layers as rows means tracking every property it knows about');
check('thumbnails are validated and capped',
  /MAX_THUMB_CHARS/.test(route) && /startsWith\('data:image\/'\)/.test(route),
  'an uncapped data URL in a column is how a row reaches megabytes and the list stops loading');
check('a malformed id is a 404 rather than a database error',
  /UUID_RE\.test/.test(route));

// --- the editor behaves ------------------------------------------------------
check('selecting a layer does not reorder it',
  /preserveObjectStacking: true/.test(page),
  'without it, clicking a layer raises it and the stack silently changes');
check('fonts are loaded before a scene is rendered',
  /await Promise\.all\(families\.map\(ensureFont\)\)/.test(page),
  'text rendered before its face arrives measures at the fallback metrics and wraps wrong');
check('and before an export is rasterised',
  /await document\.fonts\.ready;[\s\S]{0,120}toDataURL/.test(page),
  'this is where a graphic silently goes out in the wrong typeface');
check('a background image covers the page rather than stretching',
  /Math\.max\(c\.width \/ img\.width, c\.height \/ img\.height\)/.test(page));

// --- the work cannot be lost, part two: the effect that destroyed it ---------
//
// This is the bug that cost a real afternoon's work. save() replaced the
// `project` state object on every autosave to carry a fresh thumbnail; the
// canvas effect depended on that object's identity, so every fifteen seconds
// the canvas was disposed, rebuilt, and reloaded from the scene fetched when
// the project was opened. Everything added since went silently.
//
// The guard is the general property, not the specific line: an effect that
// tears the canvas down must not be wired to the identity of a state object.

const bodyOf = (needle) => {
  const i = page.indexOf(needle);
  if (i < 0) return '';
  const j = page.indexOf('}, [', i);
  return j < 0 ? page.slice(i) : page.slice(i, j);
};
const depsAfter = (needle) => {
  const i = page.indexOf(needle);
  if (i < 0) return null;
  const j = page.indexOf('}, [', i);
  if (j < 0) return null;
  return page.slice(j + 4, page.indexOf(']', j));
};

const canvasDeps = depsAfter('new Canvas(');
check('the canvas is not rebuilt when the project object is replaced',
  canvasDeps !== null && !/\bproject\b/.test(canvasDeps),
  `the canvas effect depends on: ${canvasDeps} — a state object's identity there disposes the canvas mid-edit`);
check('and it is rebuilt when the size genuinely changes',
  /\bpw\b/.test(canvasDeps || '') && /\bph\b/.test(canvasDeps || ''));

const showPageDeps = depsAfter('const showPage = useCallback');
check('loading a scene is not wired to the project object either',
  showPageDeps !== null && !/\bproject\b/.test(showPageDeps),
  `showPage depends on: ${showPageDeps} — this is what reloaded the stale scene`);
check('so its pages are read through a ref', /pagesRef\.current\.find/.test(page));

check('autosave does not replace the project object',
  !/setProject\(/.test(bodyOf('const save = useCallback')),
  'that is the write that triggered the whole chain');
check('a fresh thumbnail is held separately',
  /setThumbs\(t => \(\{ \.\.\.t, \[id\]: thumbnail \}\)\)/.test(page));

// --- placing and aligning ----------------------------------------------------
check('a layer snaps while it is dragged',
  /c\.on\('object:moving', \(e\) => snapMoving\(c, e\.target\)\)/.test(page));
check('the candidates are the page and every other layer',
  /const xs = \[0, c\.width \/ 2, c\.width\]/.test(page)
  && /for \(const o of c\.getObjects\(\)\)[\s\S]{0,200}r\.left \+ r\.width \/ 2/.test(page),
  'corners come from the page lines, aligning text to text from the object lines');
check('the moving layer offers its own three lines per axis',
  /nearest\(\[b\.left, b\.left \+ b\.width \/ 2, b\.left \+ b\.width\]/.test(page),
  'without the centre and the far edge, only the left edge ever snaps');
check('snapping shifts rather than assigns a position',
  /obj\.set\('left', obj\.left \+ x\.shift\)/.test(page),
  'assigning left is wrong for any object whose origin is not top-left');
check('guides cannot reach the scene, the thumbnail or the export',
  /c\.getContext\(\)/.test(page) && !/new Line\(/.test(page) && /ocGuides = \[\]/.test(page),
  'a guide added as a canvas object would be saved and rasterised into the PNG');

check('images can be dropped onto the page', /onDrop=\{onDrop\}/.test(page));
check('a dropped file is kept as a client asset, not only in the scene',
  /for \(const f of files\) await uploadAsset\(f, \{ at \}\)/.test(page),
  'the point of the rail is that an image uploaded once is reusable on every post');
check('the drop point is measured from the element, not from the display scale',
  /box\.width \/ pw/.test(page),
  'the wrapper is CSS-scaled, so a drop read in screen pixels lands in the wrong place');
check('assets drag off the rail as well',
  /dataTransfer\.setData\('text\/oc-asset'/.test(page));

// --- the client's own fonts --------------------------------------------------
check('uploaded font files are kept out of the image rail',
  /!isFont\(a\)/.test(page),
  'a .ttf in an image rail renders as a broken image, which is what shipped first');
check('and are loaded as real faces',
  /new FontFace\(name,/.test(page) && /document\.fonts\.add\(face\)/.test(page));
check('the picker offers them above the Google families',
  /\[\.\.\.clientFonts, \.\.\.FONTS\]/.test(page));
check('a face that fails to load stays retryable',
  /catch \{ loaded\.delete\(name\); \}/.test(page),
  'leaving it in the loaded set means it never loads again this session');

// --- it is not loaded by people who never open it ----------------------------
check('the editor is code-split',
  /lazy\(\(\) => import\('\.\/ClientDesignPage'\)\)/.test(tab),
  'Fabric is 300KB; nobody who never opens this tab should download it');
check('with something on screen while it loads', /Suspense/.test(tab));
check('and it is agency-only', /readOnly \? \[\] : \[\{ key: 'design'/.test(tab));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

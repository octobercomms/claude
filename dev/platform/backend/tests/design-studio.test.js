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
const brandRoute = read('src', 'routes', 'brandAssets.js');
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
  /MAX_THUMB_CHARS/.test(route) && /THUMB_RE\.test\(t\)/.test(route),
  'an uncapped data URL in a column is how a row reaches megabytes and the list stops loading');
check('and are raster types only',
  /\^data:image\\\/\(png\|jpeg\|webp\);base64,/.test(route),
  'the thumbnail is served back with its own Content-Type, so data:image/svg+xml would be stored XSS on the API origin');
check('a thumbnail is served as an image, not carried in the JSON',
  /router\.get\('\/pages\/:id\/thumbnail'/.test(route) && /thumbSrc\(/.test(page),
  'a hundred sets with a 26KB cover each is 2.6MB per visit, none of it cacheable');
check('with a private, immutable cache keyed to the save time',
  /Cache-Control', 'private, max-age=31536000, immutable'/.test(route)
  && /\?v=\$\{encodeURIComponent\(v \|\| ''\)\}/.test(page),
  'public would let a shared cache hand one client\u2019s artwork to another');
{
  const listQuery = route.slice(route.indexOf('SELECT p.*'), route.indexOf('ORDER BY p.updated_at DESC'));
  check('the project list selects no thumbnail bytes at all',
    listQuery.length > 0 && !/thumbnail/.test(listQuery.replace(/thumbnail IS NOT NULL/g, '')),
    'embedding one cover per set is what made a hundred sets 2.6MB; it names the page instead');
}
check('and no page payload carries the blob',
  /PAGE_COLS/.test(route) && !/SELECT \* FROM design_pages/.test(route),
  'SELECT * puts 26KB of base64 into every page row of every response');
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

// --- the crash a build cannot see --------------------------------------------
//
// A useEffect whose dependency array names a const that is declared further
// down the component throws "Cannot access X before initialization" on every
// render. There is no conditional path and no bad input: the component is
// simply dead. `vite build` compiles it happily, the rules-of-hooks lint does
// not look at it, and a regex guard for the feature itself passes because the
// code is all present and correct — in the wrong order.
//
// This shipped once and took the whole Design tab down, including the empty
// project list. The guard is the general property: nothing named in a
// dependency array may be declared below the hook that names it.
//
// It reads the file as one component. If this page ever grows a second one,
// a prop in the first that shares a name with a const in the second would
// read as a violation here; split the scan by component at that point.
{
  const decl = {};
  for (const m of page.matchAll(/^ {2}const (\w+) = (?:useCallback|useMemo|async |\()/gm)) {
    if (decl[m[1]] === undefined) decl[m[1]] = m.index;
  }
  const tdz = [];
  for (const m of page.matchAll(/\}, \[([^\]]*)\]\)/g)) {
    for (const name of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
      if (decl[name] !== undefined && decl[name] > m.index) {
        tdz.push(`${name} is used in a dependency array before its declaration`);
      }
    }
  }
  check('nothing in a dependency array is declared below the hook that uses it',
    tdz.length === 0, tdz.join('; '));
}

// --- the preview keeps up ----------------------------------------------------
//
// These posts are a full-bleed photograph, and PNG is the wrong codec for one.
// Measured in Chromium on a 1080x1350 photographic post: the PNG thumbnail is
// 258,254 characters and the JPEG 26,443. The route caps a thumbnail at
// 200,000, so every PNG of a finished post was rejected and the blank first
// thumbnail stayed on the card — with the save itself succeeding, so nothing
// ever said a word.
check('the thumbnail is a JPEG',
  /format: 'jpeg', quality: [0-9.]+/.test(page),
  'a PNG of a photographic post is ten times larger than the cap allows');
check('a save still never fails over its preview',
  /thumbnail = COALESCE\(\$2, thumbnail\)/.test(route),
  'losing the scene because the preview was too big would be far worse');
check('but a rejected preview is reported rather than swallowed',
  /thumbnail_rejected: !!req\.body\?\.thumbnail && !thumb/.test(route)
  && /thumbnail_rejected/.test(page),
  'silently keeping the old one is how a stale card sits there for days');
check('and the list is refetched when the editor closes',
  /if \(!openId\) \{ setProject\(null\); loadProjects\(\); return; \}/.test(page),
  'the list is fetched once on mount, so its cover and page count stay as they were');

// --- the editing a social post actually needs --------------------------------
check('a property set reaches the layers in a multi-selection',
  /for \(const t of members\(o\)\) t\.set\(key, value\)/.test(page),
  'an ActiveSelection wraps the layers rather than being one, so setting a property on it does nothing at all');
check('case is changed by rewriting the text',
  /t\.text\.toUpperCase\(\)/.test(page),
  'Fabric has no text-transform, and the export has to be what the layer holds');
check('align works off the bounding box',
  /const b = o\.getBoundingRect\(\);[\s\S]{0,200}c\.width - b\.width - b\.left/.test(page),
  'using left/width alone is wrong for a rotated or scaled layer and disagrees with snapping');

check('a layer duplicates', /const duplicateLayer = useCallback/.test(page));
check('and from the keyboard', /e\.key\.toLowerCase\(\) === 'd'/.test(page));
check('a multi-selection is discarded before its members are cloned',
  /c\.discardActiveObject\(\);\n\s*const copies = \[\]/.test(page),
  'members hold coordinates relative to the selection while it exists, so a clone taken then lands in the wrong place');
check('the keyboard is deaf while text is being typed',
  /if \(!c \|\| !o \|\| o\.isEditing\) return;/.test(page)
  && /\['INPUT', 'TEXTAREA', 'SELECT'\]\.includes\(el\?\.tagName\)/.test(page),
  'otherwise Backspace deletes the layer instead of a character');

// --- recolouring a graphic ---------------------------------------------------
// A black logo on a white post is the case this exists for. Invert flips a flat
// file; a tint at full alpha replaces every visible pixel and leaves the alpha
// channel alone, which is what a cut-out logo needs. Both are real Fabric
// filters, so they serialise into the scene and come back on reload.
check('invert and recolour are Fabric filters, not a CSS trick',
  /new filters\.Invert\(\)/.test(page) && /new filters\.BlendColor\(/.test(page),
  'a CSS filter would not survive the scene, the thumbnail or the exported PNG');
check('the tint is at full alpha and in tint mode',
  /mode: 'tint', alpha: 1/.test(page),
  'anything less leaves the original colour showing through, and another mode does not preserve transparency');
const fxList = page.slice(page.indexOf('t.filters = ['), page.indexOf('try { t.applyFilters()'));
check('the filter list is rebuilt from the wanted state, not appended to',
  fxList.length > 0 && !/t\.filters/.test(fxList.slice(1)) && /next\.invert/.test(fxList) && /next\.tint/.test(fxList),
  'appending stacks a second invert on the first and the logo flips back');
check('a picture from another site says why it cannot be recoloured',
  /catch \{ t\.filters = \[\]; refused = true; \}/.test(page),
  'reading pixels off a tainted canvas throws, and failing silently reads as the feature being broken');

// --- you can see what you are dragging ---------------------------------------
//
// Handles are drawn in canvas coordinates and the canvas is then scaled down
// to fit, so Fabric's defaults arrive shrunk by more than half. Measured on a
// 1080x1350 page: a 13px handle lands as 6px and the 1px border as 0.46px.
check('handles are scaled back up by the amount the page is scaled down',
  /cornerSize: Math\.round\(13 \/ fit\)/.test(page) && /borderScaleFactor: 2 \/ fit/.test(page),
  'left at the defaults the frame is a sub-pixel hairline');
check('the canvas and the layout share one definition of that scale',
  /const fitFor = \(w, h\) =>/.test(page) && (page.match(/620 \//g) || []).length === 2,
  'two copies drift, and then the handles sit somewhere other than the layer');
check('a text layer has no vertical handles',
  /if \(isTextObj\(o\)\) o\.setControlsVisibility\(\{ mt: false, mb: false \}\)/.test(page),
  'they only stretch the glyphs, and the top one sits under the rotate handle');
check('the selection frame is not the colour of the snap guides',
  /borderColor: '#2d7ff9'/.test(page) && /strokeStyle = '#ff2d6f'/.test(page),
  'one says where this layer is and the other what it lined up with; they appear together');

check('a corner drag is written back into the real font size',
  /o\.set\(\{ fontSize: o\.fontSize \* s, width: o\.width \* s, scaleX: 1, scaleY: 1 \}\)/.test(page),
  'Fabric scales a text layer rather than resizing it, so the size box went on reading 92 while it rendered at 138');
check('but only when the drag was uniform',
  /o\.scaleX !== o\.scaleY\) return;/.test(page),
  'holding shift stretches the glyphs on purpose, and there is no honest font size for that');
check('and the box width can be typed',
  /onCommit=\{v => setProp\('width', Math\.round\(v\)\)\}/.test(page));

// --- bringing a Photoshop file in --------------------------------------------
//
// The behaviour is covered by a browser run (tests/browser/psd.mjs) against a
// real PSD, because it is canvas work. These are the structural properties a
// later edit could undo without that run noticing.
const sceneBuilder = codeOnly(fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'psdToScene.js'), 'utf8'));
const parser = codeOnly(fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'psdImport.js'), 'utf8'));

check('the PSD library is loaded only when a file is actually opened',
  /await import\('ag-psd'\)/.test(parser),
  '811KB on the main chunk for a feature most sessions never touch');
check('parsing happens in the browser',
  /file\.arrayBuffer\(\)/.test(parser) && !/multer|formidable/.test(route),
  'a 200MB PSD should not cross the network, and the server should not need a native image library');

check('the scene is serialised by Fabric, not hand-written',
  /new StaticCanvas\(/.test(sceneBuilder) && /canvas\.toJSON\(\)/.test(sceneBuilder),
  "Fabric's JSON has required fields that move between releases; a hand-rolled object opens as a blank page");
check('type is fitted to its recorded box',
  /fitFontSize\(measure, box, layer\.reportedSize\)/.test(sceneBuilder),
  'the reported size was right in one real file and a third too large in another');
check('and a layer with no bounds still gets a real box',
  /const width = box \? box \+ 1 : Math\.ceil\(measure\(fontSize\)\) \+ 2;/.test(sceneBuilder),
  'at Fabric\u2019s minimum width the box stretches to the longest unbreakable word, which is not where the text was');

check('layer images are deduplicated by content',
  /seen\.get\(layer\.hash\)/.test(sceneBuilder) && /crypto\.subtle\.digest\('SHA-256'/.test(parser),
  'one logo across forty posts would otherwise be forty uploads on the first import');
check('and the hash is validated before it is stored',
  /\^\[0-9a-f\]\{64\}\$/.test(brandRoute) && /sha256/.test(brandRoute),
  'it comes from the browser and is only ever a lookup key');

check('nothing is written until the files have been looked at',
  /async function readPsds\(/.test(page) && /async function runImport\(/.test(page)
  && !/runImport\(\)/.test(page.slice(page.indexOf('async function readPsds('), page.indexOf('async function runImport('))),
  'an import that silently creates twenty wrong sets is worse than one that creates none');
check('a campaign can come in as one set with a page per file',
  /const oneSet = psdOneSet && chosen\.length > 1 && sameSize;/.test(page)
  && /api\.post\(`\/design\/projects\/\$\{project\.id\}\/pages`/.test(page),
  'forty posts from one campaign as forty separate sets is not how the work is organised');
check('and only when every file is the same size',
  /const sameSize = new Set\(chosen\.map[\s\S]{0,80}\)\.size === 1;/.test(page)
  && /psdOneSet && chosen\.length > 1 && sameSize/.test(page),
  'a set has one width and height; checked where the import runs, not only where the radio was set');
check('pages are ordered by number rather than by string',
  /numeric: true/.test(page) && /byName\.compare\(a\.file\.name, b\.file\.name\)/.test(page),
  'a plain sort puts -44 before -6');
check('the set is named from what the files have in common',
  /commonName\(ok\.map\(r => r\.file\.name\)\)/.test(page),
  'nobody should have to retype the campaign name that is already on every file');

check('and the review shows how much text survived',
  /editable text/.test(page) && /texts \? 'var\(--positive\)' : 'var\(--warning\)'/.test(page),
  'zero means Adobe flattened the type and every headline will need retyping');

// --- the icon actions still say what they do ---------------------------------
check('a glyph-only action carries a label',
  (page.match(/btn-icon/g) || []).length >= 4
  && (page.match(/aria-label=\{`(Duplicate|Delete)/g) || []).length >= 4,
  'a bare glyph is unreadable to a screen reader and ambiguous on hover without a title');
check('and the destructive one is marked as such',
  /btn-icon btn-icon-sm danger/.test(page),
  'delete and duplicate sitting side by side as identical grey glyphs is how a set gets deleted by accident');

// --- it is not loaded by people who never open it ----------------------------
check('the editor is code-split',
  /lazy\(\(\) => import\('\.\/ClientDesignPage'\)\)/.test(tab),
  'Fabric is 300KB; nobody who never opens this tab should download it');
check('with something on screen while it loads', /Suspense/.test(tab));
check('and it is agency-only', /readOnly \? \[\] : \[\{ key: 'design'/.test(tab));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

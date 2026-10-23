import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Canvas, FabricImage, Textbox, Rect, filters } from 'fabric';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

// Design — layered social posts, made here instead of in Canva or Express.
//
// The shape of this follows how the work is actually done: a project is a set
// of posts for a campaign, each page a variation at the same size, built from
// a full-bleed photo, a few text layers and logo lockups on top. You build the
// first one, duplicate it, and swap the photo and the headline. There is no
// template library, because duplication covers the same ground without
// anything to curate.
//
// Assets come from brand_assets, which already stores a client's logos and
// images with upload and authenticated serving. Upload once, reuse on every
// post, for this client only.
//
// Export is client-side: the canvas rasterises what the browser has already
// drawn, so a font renders in the file exactly as it renders on screen. That
// avoids the usual trap where a server-side renderer silently substitutes a
// fallback face because the font was linked rather than loaded.

// Sizes worth having to hand. Anything else goes in the custom boxes.
const PRESETS = [
  { label: 'Instagram portrait', w: 1080, h: 1350 },
  { label: 'Instagram square', w: 1080, h: 1080 },
  { label: 'Story / Reel', w: 1080, h: 1920 },
  { label: 'LinkedIn', w: 1200, h: 627 },
  { label: 'A4 portrait', w: 2480, h: 3508 },
];

// A short list rather than all 1,800 Google families: a picker nobody can
// scroll is not a feature. Brockmann is the house face and is already served
// by the platform, so it needs no loading.
const FONTS = [
  { name: 'Brockmann', local: true },
  { name: 'Inter' }, { name: 'Montserrat' }, { name: 'Playfair Display' },
  { name: 'Poppins' }, { name: 'Lora' }, { name: 'Oswald' },
  { name: 'Source Sans 3' }, { name: 'Libre Baskerville' }, { name: 'Space Grotesk' },
];

// Load a Google family once and wait for it, so the first render of a text
// layer is in the right face rather than a fallback that reflows a moment
// later. document.fonts.ready is what makes the export reliable too.
const loaded = new Set(['Brockmann']);

// A client's own faces, uploaded to their brand kit as kind 'font'. Keyed by
// the family name the picker shows, so ensureFont can serve an uploaded face
// and a Google one through the same call.
const uploadedFonts = new Map();   // family -> url

const FONT_FILE_RE = /\.(ttf|otf|woff2?|eot)$/i;
const familyOf = (a) => String(a.name || a.url).split('/').pop()
  .replace(FONT_FILE_RE, '').replace(/[-_]+/g, ' ').trim() || 'Uploaded font';

async function ensureFont(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const uploaded = uploadedFonts.get(name);
  if (uploaded) {
    try {
      const face = new FontFace(name, `url("${uploaded}")`);
      await face.load();
      document.fonts.add(face);
    } catch { loaded.delete(name); }   // leave it retryable rather than stuck
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;600;700;800&display=swap`;
  document.head.appendChild(link);
  try { await document.fonts.load(`700 24px "${name}"`); await document.fonts.ready; }
  catch { /* the face will fall back; nothing to recover */ }
}

// ── snapping ────────────────────────────────────────────────────────────────
//
// One mechanism covers both things worth having: drag a layer near the page's
// edge, centre or corner and it locks to it; drag it near another layer and it
// lines up with that layer's edges or centre. The candidates are the page's
// own three lines per axis plus every other object's three, and the moving
// object offers its own three, so "left edges flush", "centred on the page"
// and "both headlines on the same baseline" all fall out of one comparison.

const isTextObj = (o) => !!o && ['textbox', 'Textbox', 'i-text', 'IText', 'text', 'Text'].includes(o.type);
const isImageObj = (o) => !!o && (o.type === 'image' || o.type === 'Image');
// An ActiveSelection wraps the layers rather than being one, so a property set
// on it silently does nothing. Everything below applies to its members.
const members = (o) => (typeof o?.getObjects === 'function' ? o.getObjects() : [o]);

// The page is drawn at this fraction of its real size to fit the screen. Used
// by the canvas and by the layout, which must agree or the handles land in the
// wrong place.
const fitFor = (w, h) => Math.min(620 / w, 620 / h, 1);

// Selection handles are drawn in canvas coordinates and the whole canvas is
// then scaled down to fit, so Fabric's defaults arrive tiny: measured on a
// 1080x1350 page, a 13px handle lands as 6px on screen and the 1px border as
// 0.46px, a sub-pixel hairline. Scale them back up so they are the size they
// were meant to be, and make them read against a photograph rather than
// against white.
function styleControls(o, fit) {
  if (!o || !fit) return;
  o.set({
    cornerSize: Math.round(13 / fit),
    touchCornerSize: Math.round(30 / fit),
    borderScaleFactor: 2 / fit,
    padding: Math.round(4 / fit),
    transparentCorners: false,
    cornerStyle: 'circle',
    cornerColor: '#ffffff',
    cornerStrokeColor: '#1b5fc1',
    // Blue, deliberately not the pink the snap guides use: one is where this
    // layer is, the other is what it has lined up with, and they appear at the
    // same moment.
    borderColor: '#2d7ff9',
  });
  // A text layer's height comes from its text and line height. The top and
  // bottom handles only stretch the glyphs, and the top one sits under the
  // rotate handle, so dragging to resize catches rotate instead.
  if (isTextObj(o)) o.setControlsVisibility({ mt: false, mb: false });
}

// A corner drag scales a text layer rather than resizing it, so the size box
// goes on reading 92 while the headline renders at 138. Bake the scale back
// into the real properties. Checked in Chromium: 92 at scale 1.5 and 138 at
// scale 1 render to an identical height, so nothing moves on screen.
//
// Only when the drag was uniform. Holding shift stretches the glyphs on
// purpose, and there is no honest font size for that.
function bakeTextScale(c, o) {
  if (!isTextObj(o) || o.scaleX === 1 || o.scaleX !== o.scaleY) return;
  const s = o.scaleX;
  o.set({ fontSize: o.fontSize * s, width: o.width * s, scaleX: 1, scaleY: 1 });
  o.initDimensions?.();
  o.setCoords();
  c.requestRenderAll();
}

// A thumbnail is fetched as an image, not carried inline in the JSON. The
// version is the page's updated_at, so the URL changes exactly when the
// picture does and the browser can cache each one indefinitely. A list of a
// hundred sets was otherwise 2.6MB of base64 on every visit, none of it
// cacheable.
const thumbSrc = (pageId, v) =>
  `/api/design/pages/${pageId}/thumbnail?v=${encodeURIComponent(v || '')}`;

const SNAP_TOL_RATIO = 0.006;   // ~6px on a 1080 page, ~13px on A4

function snapTargets(c, moving) {
  const xs = [0, c.width / 2, c.width];
  const ys = [0, c.height / 2, c.height];
  for (const o of c.getObjects()) {
    if (o === moving || o.visible === false) continue;
    const r = o.getBoundingRect();
    xs.push(r.left, r.left + r.width / 2, r.left + r.width);
    ys.push(r.top, r.top + r.height / 2, r.top + r.height);
  }
  return { xs, ys };
}

function nearest(mine, targets, tol) {
  let best = null;
  for (const m of mine) {
    for (const t of targets) {
      const d = Math.abs(t - m);
      if (d <= tol && (best === null || d < best.d)) best = { d, shift: t - m, at: t };
    }
  }
  return best;
}

function snapMoving(c, obj) {
  if (!obj) return;
  const tol = Math.max(3, c.width * SNAP_TOL_RATIO);
  const b = obj.getBoundingRect();
  const { xs, ys } = snapTargets(c, obj);
  const x = nearest([b.left, b.left + b.width / 2, b.left + b.width], xs, tol);
  const y = nearest([b.top, b.top + b.height / 2, b.top + b.height], ys, tol);
  // Shift left/top by the bounding box's delta rather than assigning a
  // position: that is origin-agnostic, and a text layer, a rotated image and
  // a rectangle do not share an origin.
  if (x) obj.set('left', obj.left + x.shift);
  if (y) obj.set('top', obj.top + y.shift);
  if (x || y) obj.setCoords();
  c.ocGuides = [...(x ? [{ x: x.at }] : []), ...(y ? [{ y: y.at }] : [])];
}

// Guides are painted onto the live canvas context after each render rather
// than added as objects, so they cannot reach the scene JSON, the thumbnail
// or the export. They are cleared the moment the drag ends.
function drawGuides(c) {
  const lines = c.ocGuides;
  if (!lines || !lines.length) return;
  const ctx = c.getContext();
  ctx.save();
  ctx.strokeStyle = '#ff2d6f';
  ctx.lineWidth = Math.max(1, c.width / 540);
  for (const l of lines) {
    ctx.beginPath();
    if (l.x !== undefined) { ctx.moveTo(l.x, 0); ctx.lineTo(l.x, c.height); }
    else { ctx.moveTo(0, l.y); ctx.lineTo(c.width, l.y); }
    ctx.stroke();
  }
  ctx.restore();
}

const clearGuides = (c) => { if (c.ocGuides?.length) { c.ocGuides = []; c.requestRenderAll(); } };

// A number box that can be cleared and typed into.
//
// A plainly controlled <input type="number"> whose value comes off the Fabric
// object fights the person using it: clearing the box parses as NaN, clamping
// on every keystroke turns a typed "120" into "8" at the first digit, and the
// value React writes back overwrites what was half-typed. So the draft is held
// locally, every parseable keystroke reaches the canvas, and the clamp happens
// on blur.
function NumField({ value, min, max, step = 1, title, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <input
      className="input" type="number" min={min} max={max} step={step} title={title}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v)) onCommit(v);
      }}
      onBlur={() => {
        const v = Number(draft);
        const next = Number.isFinite(v) && draft !== '' ? Math.min(max, Math.max(min, v)) : value;
        setDraft(String(next));
        onCommit(next);
      }}
    />
  );
}

export default function ClientDesignPage({ embedded = false, clientId: clientIdProp } = {}) {
  const { id: routeId } = useParams();
  const clientId = clientIdProp || routeId;
  const toast = useToast();
  const { readOnly } = useAuth();
  const [params, setParams] = useSearchParams();
  const openId = params.get('design') || null;

  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [assets, setAssets] = useState([]);
  const [clientFonts, setClientFonts] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(null);   // the selected fabric object
  const [layers, setLayers] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [thumbs, setThumbs] = useState({});   // page id -> freshly saved thumbnail
  const [saving, setSaving] = useState(false);
  // Fabric mutates the selected object in place, so its identity never
  // changes and React has nothing to compare. Without this counter,
  // setSelected(o) is a no-op, the panel never re-renders, and a controlled
  // input is written straight back to the value it had — which is exactly
  // what made the font and size boxes look broken.
  const [, bump] = useReducer(x => x + 1, 0);

  const canvasEl = useRef(null);
  const dropEl = useRef(null);       // the scaled wrapper, for drop coordinates
  const fc = useRef(null);            // the fabric canvas
  const pageRef = useRef(null);       // page id the canvas currently holds
  const dirtyRef = useRef(false);
  const warnedThumb = useRef(false);

  const open = useCallback((id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('design', id); else next.delete('design');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── loading ────────────────────────────────────────────────────────────────

  const loadProjects = useCallback(async () => {
    try { const r = await api.get(`/design/clients/${clientId}/projects`); setProjects(r.items || []); }
    catch (e) { toast(e.message, 'error'); setProjects([]); }
  }, [clientId, toast]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    // Mounted at /api/brand, and it answers with a bare array rather than
    // { items }. Both are easy to get wrong from memory; checked against
    // routes/brandAssets.js.
    api.get(`/brand/clients/${clientId}/assets`)
      .then(async (r) => {
        const all = (Array.isArray(r) ? r : (r?.items || [])).filter(a => a.url);
        const isFont = (a) => a.kind === 'font' || FONT_FILE_RE.test(a.url);
        // The rail is an image rail. An uploaded .ttf left in it renders as a
        // broken image, which is exactly what the first release did.
        setAssets(all.filter(a => !isFont(a) && a.kind !== 'b_roll_clip'));
        const fonts = all.filter(isFont).map(a => ({ name: familyOf(a), url: a.url }));
        setClientFonts(fonts);
        for (const f of fonts) uploadedFonts.set(f.name, f.url);
        // Register them now rather than on first use: the asset fetch races
        // the scene load, and a scene that already uses an uploaded face must
        // not render at the fallback's metrics.
        await Promise.all(fonts.map(f => ensureFont(f.name)));
        fc.current?.requestRenderAll();
      })
      .catch(() => { setAssets([]); setClientFonts([]); });
  }, [clientId]);

  useEffect(() => {
    // Leaving the editor: refresh the list, or its cover and page count stay
    // as they were when this page first loaded.
    if (!openId) { setProject(null); loadProjects(); return; }
    api.get(`/design/projects/${openId}`)
      .then(p => { setProject(p); setPageId(p.pages?.[0]?.id || null); })
      .catch(e => { toast(e.message, 'error'); open(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // ── the canvas ─────────────────────────────────────────────────────────────

  const syncLayers = useCallback(() => {
    const c = fc.current;
    if (!c) return;
    // Topmost first, which is how a layers panel reads.
    setLayers(c.getObjects().slice().reverse());
    setSelected(c.getActiveObject() || null);
  }, []);

  const markDirty = useCallback(() => { dirtyRef.current = true; setDirty(true); }, []);

  // The canvas is built once per project and torn down only when the project
  // or its dimensions change.
  //
  // This used to depend on the whole `project` object, and save() replaced that
  // object on every autosave to carry a new thumbnail. So every fifteen
  // seconds the canvas was disposed, rebuilt, and reloaded from the scene
  // fetched when the project was opened — silently throwing away everything
  // added since. Depending on the identity of a state object in an effect that
  // destroys work is the whole bug; these three primitives are what the canvas
  // actually needs.
  const projectId = project?.id;
  const pw = project?.width;
  const ph = project?.height;

  useEffect(() => {
    if (!projectId || !canvasEl.current) return undefined;
    const c = new Canvas(canvasEl.current, {
      width: pw,
      height: ph,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,   // selecting a layer must not raise it
    });
    fc.current = c;
    const fit = fitFor(pw, ph);
    for (const ev of ['object:added', 'object:modified', 'object:removed', 'text:changed']) {
      c.on(ev, () => { markDirty(); syncLayers(); });
    }
    // Every layer, however it arrived: added here, or revived from a saved
    // scene by loadFromJSON, which adds each object the same way.
    c.on('object:added', (e) => styleControls(e.target, fit));
    c.on('object:modified', (e) => bakeTextScale(c, e.target));
    for (const ev of ['selection:created', 'selection:updated', 'selection:cleared']) {
      c.on(ev, syncLayers);
    }
    c.on('object:moving', (e) => snapMoving(c, e.target));
    c.on('after:render', () => drawGuides(c));
    for (const ev of ['mouse:up', 'object:modified', 'selection:cleared']) {
      c.on(ev, () => clearGuides(c));
    }
    return () => { c.dispose(); fc.current = null; };
  }, [projectId, pw, ph, markDirty, syncLayers]);

  // Put a page's scene on the canvas. Fonts are loaded first: a text layer
  // rendered before its face arrives measures at the fallback's metrics and
  // wraps in the wrong place.
  // Pages are read through a ref so that loading a scene is not wired to the
  // identity of the project object. Same reason as the canvas effect above: a
  // re-render must never be able to reload the canvas from a stale scene.
  const pagesRef = useRef([]);
  useEffect(() => { pagesRef.current = project?.pages || []; }, [project]);

  const showPage = useCallback(async (id) => {
    const c = fc.current;
    const page = pagesRef.current.find(p => p.id === id);
    if (!c || !page) return;
    const scene = page.scene && Object.keys(page.scene).length ? page.scene : null;
    const families = [...new Set((scene?.objects || []).map(o => o.fontFamily).filter(Boolean))];
    await Promise.all(families.map(ensureFont));
    if (scene) await c.loadFromJSON(scene);
    else { c.clear(); c.backgroundColor = '#ffffff'; }
    c.renderAll();
    pageRef.current = id;
    dirtyRef.current = false; setDirty(false);
    syncLayers();
  }, [syncLayers]);

  // Only when the page actually changes, or the canvas is rebuilt for a new
  // project. Not on every render.
  useEffect(() => { if (pageId && projectId) showPage(pageId); }, [pageId, projectId, showPage]);

  // ── saving ─────────────────────────────────────────────────────────────────

  const save = useCallback(async ({ quiet = true } = {}) => {
    const c = fc.current;
    const id = pageRef.current;
    if (!c || !id) return;
    setSaving(true);
    try {
      // A postage stamp for the page strip, not a copy of the artwork — and
      // a JPEG, because these posts are a full-bleed photograph and PNG is the
      // wrong codec for one. Measured in Chromium on a 1080x1350 photographic
      // post: PNG 258,254 characters, JPEG at this quality 26,443. The route
      // caps a thumbnail at 200,000, so every PNG of a finished post was
      // silently rejected and the blank first thumbnail stayed on the card.
      const thumbnail = c.toDataURL({ format: 'jpeg', quality: 0.72, multiplier: 220 / Math.max(c.width, 1) });
      const saved = await api.put(`/design/pages/${id}`, { scene: c.toJSON(), thumbnail });
      dirtyRef.current = false; setDirty(false);
      // The server keeps the previous thumbnail rather than failing the save
      // when one is too big. Say so once, because the failure is otherwise
      // invisible: the work is saved and only the preview quietly rots.
      if (saved?.thumbnail_rejected && !warnedThumb.current) {
        warnedThumb.current = true;
        toast('Your work is saved, but the preview image was too large to store.', 'error');
      }
      // Held separately rather than merged into `project`: replacing that
      // object is what used to tear the canvas down mid-edit.
      setThumbs(t => ({ ...t, [id]: thumbnail }));
      if (!quiet) toast('Saved');
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    finally { setSaving(false); }
  }, [toast]);

  // Autosave, and save before switching page or leaving. Design work that
  // vanishes on a reload is the same failure as a lost recording.
  useEffect(() => {
    const t = setInterval(() => { if (dirtyRef.current) save(); }, 15000);
    return () => clearInterval(t);
  }, [save]);

  useEffect(() => {
    if (!project) return undefined;
    const warn = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = 'You have unsaved changes.'; return e.returnValue; } return undefined; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [projectId]);

  async function goToPage(id) {
    if (id === pageId) return;
    if (dirtyRef.current) await save();
    setPageId(id);
  }

  // ── editing ────────────────────────────────────────────────────────────────

  async function addImage(url, { fill = false, at = null } = {}) {
    const c = fc.current;
    if (!c) return;
    try {
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      if (fill) {
        // Cover the page, centred: the full-bleed photo every one of these
        // posts starts from.
        const s = Math.max(c.width / img.width, c.height / img.height);
        img.set({ scaleX: s, scaleY: s, left: (c.width - img.width * s) / 2, top: (c.height - img.height * s) / 2 });
        c.add(img);
        c.sendObjectToBack(img);
      } else {
        const s = Math.min(1, (c.width * 0.4) / img.width);
        // Dropped images land centred under the cursor; clicked ones sit in
        // the top-left so a run of clicks does not stack in one spot.
        img.set({
          scaleX: s, scaleY: s,
          left: at ? at.x - (img.width * s) / 2 : c.width * 0.08,
          top: at ? at.y - (img.height * s) / 2 : c.height * 0.08,
        });
        c.add(img);
        c.setActiveObject(img);
      }
      c.renderAll();
    } catch { toast('That image could not be loaded onto the canvas.', 'error'); }
  }

  async function addText() {
    const c = fc.current;
    if (!c) return;
    await ensureFont('Inter');
    const t = new Textbox('Your headline', {
      left: c.width * 0.08, top: c.height * 0.1, width: c.width * 0.84,
      fontFamily: 'Brockmann', fontSize: Math.round(c.width * 0.085), fontWeight: 800,
      fill: '#ffffff', lineHeight: 1.05,
    });
    c.add(t); c.setActiveObject(t); c.renderAll();
  }

  function addBand() {
    const c = fc.current;
    if (!c) return;
    // A flat block, for the scrim behind text over a busy photo.
    const r = new Rect({
      left: 0, top: c.height * 0.55, width: c.width, height: c.height * 0.45,
      fill: 'rgba(0,0,0,0.35)',
    });
    c.add(r); c.setActiveObject(r); c.renderAll();
  }

  async function uploadAsset(file, place = { fill: true }) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'product_image');
    fd.append('name', file.name);
    try {
      const a = await api.postForm(`/brand/clients/${clientId}/assets`, fd);
      setAssets(prev => [a, ...prev]);
      if (a.url) await addImage(a.url, place);
    } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
  }

  // Drop onto the canvas: a file from the desktop, an asset dragged off the
  // rail, or an image dragged out of another tab. The wrapper is CSS-scaled,
  // so the drop point is converted back into page coordinates from its own
  // measured width rather than from the `fit` used to draw it.
  const canvasPoint = (e) => {
    const box = dropEl.current?.getBoundingClientRect();
    if (!box || !box.width || !pw) return null;
    const s = box.width / pw;
    return { x: (e.clientX - box.left) / s, y: (e.clientY - box.top) / s };
  };

  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const at = canvasPoint(e);
    const fromRail = e.dataTransfer.getData('text/oc-asset');
    if (fromRail) { await addImage(fromRail, { at }); return; }
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      // Dropped files are uploaded to this client's assets, so the image is
      // reusable on every later post rather than living in one scene.
      for (const f of files) await uploadAsset(f, { at });
      return;
    }
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
    if (/^https?:\/\//.test(uri)) await addImage(uri, { at });
  }

  const act = (fn) => () => { const c = fc.current; const o = c?.getActiveObject(); if (c && o) { fn(c, o); c.renderAll(); markDirty(); syncLayers(); } };
  const raise = act((c, o) => c.bringObjectForward(o));
  const lower = act((c, o) => c.sendObjectBackwards(o));
  const toFront = act((c, o) => c.bringObjectToFront(o));
  const toBack = act((c, o) => c.sendObjectToBack(o));
  const remove = act((c, o) => { c.remove(o); c.discardActiveObject(); });

  // setSelected(null) then setSelected(o) is how the panel re-reads a property
  // it does not otherwise know has changed; the object identity is unchanged.
  const reread = (c, o) => { c.renderAll(); markDirty(); setSelected(o); bump(); };

  function setProp(key, value) {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    for (const t of members(o)) t.set(key, value);
    reread(c, o);
  }

  // Upper case and sentence case rather than a text-transform: Fabric has no
  // such property, and what is exported has to be what the layer holds.
  const setCase = (mode) => () => {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    for (const t of members(o)) {
      if (!isTextObj(t) || typeof t.text !== 'string') continue;
      t.set('text', mode === 'upper'
        ? t.text.toUpperCase()
        : t.text.charAt(0).toUpperCase() + t.text.slice(1).toLowerCase());
    }
    reread(c, o);
  };

  // Align the layer to the page. Worked through the bounding box so it is
  // right for a rotated or scaled layer, and so it agrees with snapping.
  const alignPage = (where) => () => {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    const b = o.getBoundingRect();
    const dx = { left: -b.left, hcentre: (c.width - b.width) / 2 - b.left, right: c.width - b.width - b.left }[where];
    const dy = { top: -b.top, vcentre: (c.height - b.height) / 2 - b.top, bottom: c.height - b.height - b.top }[where];
    if (dx !== undefined) o.set('left', o.left + dx);
    if (dy !== undefined) o.set('top', o.top + dy);
    o.setCoords();
    reread(c, o);
  };

  // Copy a layer. A multi-selection is discarded first because its members
  // hold coordinates relative to the selection while it exists, and a clone
  // taken then lands in the wrong place.
  const duplicateLayer = useCallback(async () => {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    const targets = members(o);
    c.discardActiveObject();
    const copies = [];
    for (const t of targets) {
      const copy = await t.clone();
      const step = c.width * 0.03;
      copy.set({ left: (copy.left || 0) + step, top: (copy.top || 0) + step });
      c.add(copy);
      copies.push(copy);
    }
    if (copies.length === 1) c.setActiveObject(copies[0]);
    c.renderAll(); markDirty(); syncLayers();
  }, [markDirty, syncLayers]);

  // Recolouring a graphic, which covers the black-logo-on-a-white-post case
  // without a second upload. Invert flips a flat file; a tint at full alpha
  // replaces every visible pixel and leaves the alpha channel alone, which is
  // what a cut-out logo needs.
  const fxOf = (o) => ({
    invert: (o?.filters || []).some(f => f?.type === 'Invert'),
    tint: (o?.filters || []).find(f => f?.type === 'BlendColor')?.color || null,
  });

  const setImageFx = (patch) => {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    let refused = false;
    for (const t of members(o)) {
      if (!isImageObj(t)) continue;
      const next = { ...fxOf(t), ...patch };
      t.filters = [
        ...(next.invert ? [new filters.Invert()] : []),
        ...(next.tint ? [new filters.BlendColor({ color: next.tint, mode: 'tint', alpha: 1 })] : []),
      ];
      // A picture dragged in from another site taints the canvas, and reading
      // its pixels throws. Say so rather than failing silently.
      try { t.applyFilters(); } catch { t.filters = []; refused = true; }
    }
    if (refused) toast('That picture came from another site, so its pixels cannot be read. Upload it to this client’s assets first.', 'error');
    reread(c, o);
  };

  // Duplicate and delete from the keyboard, which is how this work is actually
  // done. Suppressed while a text layer is being typed into or a panel field
  // has focus, or Backspace would delete the layer instead of a character.
  useEffect(() => {
    if (!projectId) return undefined;
    const onKey = (e) => {
      const c = fc.current;
      const o = c?.getActiveObject();
      if (!c || !o || o.isEditing) return;
      const el = e.target;
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayer(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        for (const t of members(o)) c.remove(t);
        c.discardActiveObject(); c.renderAll(); markDirty(); syncLayers();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectId, duplicateLayer, markDirty, syncLayers]);

  async function exportPage(scale = 2) {
    const c = fc.current;
    if (!c) return;
    await document.fonts.ready;
    const url = c.toDataURL({ format: 'png', multiplier: scale });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project.name || 'design').replace(/[^\w .-]+/g, '-')}-${(project.pages.findIndex(p => p.id === pageId) + 1)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── project actions ────────────────────────────────────────────────────────

  async function newProject() {
    const name = window.prompt('Name this set of posts', 'New campaign');
    if (name === null) return;
    try {
      const p = await api.post(`/design/clients/${clientId}/projects`, { name: name.trim() || 'Untitled' });
      await loadProjects(); open(p.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function duplicateProject(p) {
    try { await api.post(`/design/projects/${p.id}/duplicate`, {}); await loadProjects(); toast('Duplicated'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function deleteProject(p) {
    if (!window.confirm(`Delete “${p.name}” and all its pages? This can’t be undone.`)) return;
    try { await api.delete(`/design/projects/${p.id}`); await loadProjects(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const refreshProject = async () => {
    const p = await api.get(`/design/projects/${project.id}`);
    setProject(p);
    return p;
  };

  async function addPage() {
    if (dirtyRef.current) await save();
    try { const pg = await api.post(`/design/projects/${project.id}/pages`, {}); await refreshProject(); setPageId(pg.id); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function duplicatePage(id) {
    if (dirtyRef.current) await save();
    try { const pg = await api.post(`/design/pages/${id}/duplicate`, {}); await refreshProject(); setPageId(pg.id); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function deletePage(id) {
    if (!window.confirm('Delete this page?')) return;
    try {
      await api.delete(`/design/pages/${id}`);
      const p = await refreshProject();
      if (id === pageId) setPageId(p.pages?.[0]?.id || null);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (readOnly) return <div className="card" style={{ marginTop: 'var(--s4)' }}>Design is agency-only.</div>;

  if (!project) {
    return (
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s4)' }}>
          <p className="body-sm text-muted" style={{ maxWidth: 560, margin: 0 }}>
            Layered posts for this client. Build one, duplicate it, swap the photo and the headline.
            Images and logos you upload are kept here and reusable on every post.
          </p>
          <button {...roWrite(readOnly, { onClick: newProject })} className="btn btn-primary btn-sm">+ New set</button>
        </div>
        {projects === null ? (
          <div className="card" style={{ marginTop: 'var(--s4)' }}>Loading…</div>
        ) : !projects.length ? (
          <div className="card" style={{ marginTop: 'var(--s4)', color: 'var(--text-subtle)' }}>
            Nothing yet. Start a set and the pages live inside it.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s4)' }}>
            {projects.map(p => (
              <div key={p.id} className="card" style={{ padding: 'var(--s3)' }}>
                {/* The whole card opens the set, title included: clicking the
                    name is what everyone tries first. The two icon actions sit
                    outside it, so they are not nested inside a button. */}
                <div onClick={() => open(p.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') open(p.id); }}
                  style={{ cursor: 'pointer' }}>
                  <div style={{ aspectRatio: `${p.width}/${p.height}`, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.cover_page_id
                      ? <img src={thumbSrc(p.cover_page_id, p.cover_updated_at)} alt="" loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span className="body-sm text-subtle">Empty</span>}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 'var(--s2)' }}>{p.name}</div>
                  <div className="body-sm text-subtle">{p.page_count} page{p.page_count === 1 ? '' : 's'} · {p.width}×{p.height}</div>
                </div>
                <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                  <button onClick={() => duplicateProject(p)} className="btn-icon btn-icon-sm"
                    title={`Duplicate “${p.name}”`} aria-label={`Duplicate ${p.name}`}>⧉</button>
                  <button onClick={() => deleteProject(p)} className="btn-icon btn-icon-sm danger"
                    title={`Delete “${p.name}”`} aria-label={`Delete ${p.name}`}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const sel = selected ? members(selected) : [];
  const isText = sel.length > 0 && sel.every(isTextObj);
  const isImage = sel.length > 0 && sel.every(isImageObj);
  const fx = isImage ? fxOf(sel[0]) : { invert: false, tint: null };
  const fit = fitFor(project.width, project.height);

  return (
    <div style={{ marginTop: 'var(--s4)' }}>
      {/* top bar */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'center' }}>
          <button onClick={async () => { if (dirtyRef.current) await save(); open(null); }} className="btn btn-secondary btn-sm">← All sets</button>
          <strong>{project.name}</strong>
          <span className="body-sm text-subtle">{project.width}×{project.height}</span>
        </div>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <span className="body-sm text-subtle">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
          <button onClick={() => save({ quiet: false })} disabled={saving} className="btn btn-secondary btn-sm">Save</button>
          <button onClick={() => exportPage(2)} className="btn btn-primary btn-sm">Export PNG</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 230px', gap: 'var(--s4)', marginTop: 'var(--s4)', alignItems: 'start' }}>
        {/* left: add things */}
        <div className="card" style={{ padding: 'var(--s3)' }}>
          <div className="caption">Add</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
            <button onClick={addText} className="btn btn-secondary btn-sm">Text</button>
            <button onClick={addBand} className="btn btn-secondary btn-sm">Shade block</button>
            <label className="btn btn-secondary btn-sm" style={{ textAlign: 'center', cursor: 'pointer' }}>
              Upload image
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { uploadAsset(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>

          <div className="caption" style={{ marginTop: 'var(--s4)' }}>This client’s assets</div>
          <div className="body-sm text-subtle" style={{ marginBottom: 'var(--s2)' }}>
            Drag onto the page, or click to place. Shift-click fills the page.
            Files dropped on the page are uploaded here too.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)', maxHeight: 300, overflowY: 'auto' }}>
            {assets.map(a => (
              <img key={a.id} src={a.url} alt={a.name} title={`${a.name} — drag onto the page, or shift-click to fill it`}
                draggable
                onDragStart={e => e.dataTransfer.setData('text/oc-asset', a.url)}
                onClick={e => addImage(a.url, { fill: e.shiftKey })}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', cursor: 'pointer', padding: 2 }} />
            ))}
            {!assets.length && <span className="body-sm text-subtle">Nothing uploaded yet.</span>}
          </div>
        </div>

        {/* middle: the canvas */}
        <div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              background: 'var(--surface-sunken)', borderRadius: 'var(--r-md)', padding: 'var(--s4)',
              display: 'flex', justifyContent: 'center',
              outline: dragOver ? '2px dashed var(--accent)' : 'none', outlineOffset: -4,
            }}>
            <div ref={dropEl} style={{ width: project.width * fit, height: project.height * fit, overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,.18)' }}>
              <div style={{ transform: `scale(${fit})`, transformOrigin: 'top left' }}>
                <canvas ref={canvasEl} />
              </div>
            </div>
          </div>

          {/* pages */}
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {project.pages.map((pg, i) => {
              // The freshly saved one, held locally for the moment between
              // saving and the page row being refetched; otherwise the stored
              // one, by URL.
              const stamp = thumbs[pg.id] || (pg.has_thumbnail ? thumbSrc(pg.id, pg.updated_at) : null);
              return (
              <div key={pg.id} style={{ textAlign: 'center' }}>
                <div onClick={() => goToPage(pg.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') goToPage(pg.id); }}
                  style={{
                    width: 64, aspectRatio: `${project.width}/${project.height}`, cursor: 'pointer',
                    border: `var(--border-w) solid ${pg.id === pageId ? 'var(--accent)' : 'var(--card-border)'}`,
                    borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface)',
                  }}>
                  {stamp && <img src={stamp} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div className="body-sm text-subtle">{i + 1}</div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <button onClick={() => duplicatePage(pg.id)} title={`Duplicate page ${i + 1}`}
                    aria-label={`Duplicate page ${i + 1}`} className="btn-icon btn-icon-sm">⧉</button>
                  {project.pages.length > 1 && (
                    <button onClick={() => deletePage(pg.id)} title={`Delete page ${i + 1}`}
                      aria-label={`Delete page ${i + 1}`} className="btn-icon btn-icon-sm danger">✕</button>
                  )}
                </div>
              </div>
              );
            })}
            <button onClick={addPage} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s5)' }}>+ Page</button>
          </div>
        </div>

        {/* right: layers and the selected layer */}
        <div className="card" style={{ padding: 'var(--s3)' }}>
          <div className="caption">Layers</div>
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 'var(--s2)' }}>
            {layers.map((o, i) => {
              const active = o === selected;
              const label = (o.type === 'textbox' || o.type === 'Textbox')
                ? (o.text || 'Text').slice(0, 22)
                : (o.type === 'image' || o.type === 'Image') ? 'Image' : 'Shape';
              return (
                <div key={i} onClick={() => { const c = fc.current; c.setActiveObject(o); c.renderAll(); syncLayers(); }}
                  role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') { const c = fc.current; c.setActiveObject(o); c.renderAll(); syncLayers(); } }}
                  style={{
                    padding: 'var(--s2)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-caption)',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    fontWeight: active ? 700 : 400,
                  }}>{label}</div>
              );
            })}
            {!layers.length && <span className="body-sm text-subtle">Empty page.</span>}
          </div>

          {selected && (
            <>
              <div className="row" style={{ gap: 2, marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
                <button onClick={toFront} title="Bring to front" className="btn btn-secondary btn-sm">⤒</button>
                <button onClick={raise} title="Forward" className="btn btn-secondary btn-sm">↑</button>
                <button onClick={lower} title="Backward" className="btn btn-secondary btn-sm">↓</button>
                <button onClick={toBack} title="Send to back" className="btn btn-secondary btn-sm">⤓</button>
                <button onClick={duplicateLayer} title="Duplicate this layer (⌘D)" className="btn btn-secondary btn-sm">⧉</button>
                <button onClick={remove} title="Delete layer (⌫)" className="btn btn-secondary btn-sm">🗑</button>
              </div>

              <div className="caption" style={{ marginTop: 'var(--s3)' }}>Align to page</div>
              <div className="row" style={{ gap: 2, marginTop: 2, flexWrap: 'wrap' }}>
                <button onClick={alignPage('left')} title="Left edge" className="btn btn-secondary btn-sm">⇤</button>
                <button onClick={alignPage('hcentre')} title="Centred across" className="btn btn-secondary btn-sm">↔</button>
                <button onClick={alignPage('right')} title="Right edge" className="btn btn-secondary btn-sm">⇥</button>
                <button onClick={alignPage('top')} title="Top edge" className="btn btn-secondary btn-sm">⇡</button>
                <button onClick={alignPage('vcentre')} title="Centred down" className="btn btn-secondary btn-sm">↕</button>
                <button onClick={alignPage('bottom')} title="Bottom edge" className="btn btn-secondary btn-sm">⇣</button>
              </div>

              <div className="caption" style={{ marginTop: 'var(--s3)' }}>
                Opacity {Math.round((selected.opacity ?? 1) * 100)}%
              </div>
              <input type="range" min="0" max="100" style={{ width: '100%' }}
                value={Math.round((selected.opacity ?? 1) * 100)}
                onChange={e => setProp('opacity', Number(e.target.value) / 100)} />

              {isText && (
                <div style={{ marginTop: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                  <select className="input" value={selected.fontFamily || 'Brockmann'}
                    onChange={async (e) => {
                      // Read it first. Loading a face is awaited, and by the
                      // time it resolves React has written the controlled
                      // value back, so e.target.value is the old family again.
                      const family = e.target.value;
                      await ensureFont(family);
                      setProp('fontFamily', family);
                    }}>
                    {[...clientFonts, ...FONTS]
                      .filter((f, i, all) => all.findIndex(g => g.name === f.name) === i)
                      .map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                  <div className="row" style={{ gap: 'var(--s2)' }}>
                    <div style={{ width: 80 }}>
                      <NumField value={Math.round(selected.fontSize || 48)} min={8} max={400} title="Size"
                        onCommit={v => setProp('fontSize', Math.round(v))} />
                    </div>
                    <select className="input" value={String(selected.fontWeight || 400)}
                      onChange={e => setProp('fontWeight', parseInt(e.target.value, 10))} style={{ flex: 1 }}>
                      <option value="400">Regular</option><option value="600">Semibold</option>
                      <option value="700">Bold</option><option value="800">Extrabold</option>
                    </select>
                  </div>
                  <div className="row" style={{ gap: 'var(--s2)', alignItems: 'center' }}>
                    <input type="color" value={String(selected.fill || '#ffffff')}
                      onChange={e => setProp('fill', e.target.value)} title="Colour" />
                    <select className="input" value={selected.textAlign || 'left'}
                      onChange={e => setProp('textAlign', e.target.value)} style={{ flex: 1 }}>
                      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                    </select>
                  </div>

                  <div className="row" style={{ gap: 2, flexWrap: 'wrap' }}>
                    <button title="Italic" className="btn btn-secondary btn-sm" style={{ fontStyle: 'italic' }}
                      onClick={() => setProp('fontStyle', selected.fontStyle === 'italic' ? 'normal' : 'italic')}>I</button>
                    <button title="Underline" className="btn btn-secondary btn-sm" style={{ textDecoration: 'underline' }}
                      onClick={() => setProp('underline', !selected.underline)}>U</button>
                    <button title="UPPER CASE" className="btn btn-secondary btn-sm" onClick={setCase('upper')}>AA</button>
                    <button title="Sentence case" className="btn btn-secondary btn-sm" onClick={setCase('sentence')}>Aa</button>
                  </div>

                  <div className="row" style={{ gap: 'var(--s2)', alignItems: 'flex-end' }}>
                    <label className="body-sm text-subtle" style={{ flex: 1 }}>
                      Box width
                      <NumField value={Math.round(selected.width || 0)} min={40} max={project.width * 2}
                        step={10} onCommit={v => setProp('width', Math.round(v))} />
                    </label>
                    <button className="btn btn-secondary btn-sm" title="Span the page, inside the margins"
                      onClick={() => {
                        const c = fc.current; const o = c?.getActiveObject();
                        if (!c || !o) return;
                        const m = c.width * 0.08;
                        for (const t of members(o)) { if (isTextObj(t)) t.set({ width: c.width - m * 2, left: m }); }
                        reread(c, o);
                      }}>Span</button>
                  </div>

                  <div className="row" style={{ gap: 'var(--s2)' }}>
                    <label className="body-sm text-subtle" style={{ flex: 1 }}>
                      Line height
                      <NumField value={Number(selected.lineHeight ?? 1.16).toFixed(2)} min={0.6} max={3} step={0.05}
                        onCommit={v => setProp('lineHeight', v)} />
                    </label>
                    <label className="body-sm text-subtle" style={{ flex: 1 }}>
                      Letter spacing
                      <NumField value={Math.round(selected.charSpacing || 0)} min={-200} max={800} step={10}
                        onCommit={v => setProp('charSpacing', Math.round(v))} />
                    </label>
                  </div>
                </div>
              )}

              {isImage && (
                <div style={{ marginTop: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                  <div className="caption">Graphic</div>
                  <button onClick={() => setImageFx({ invert: !fx.invert })}
                    className={fx.invert ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
                    {fx.invert ? 'Inverted' : 'Invert'}
                  </button>
                  <div className="row" style={{ gap: 'var(--s2)', alignItems: 'center' }}>
                    <input type="color" value={fx.tint || '#ffffff'} title="Recolour this graphic"
                      onChange={e => setImageFx({ tint: e.target.value })} />
                    <span className="body-sm text-subtle" style={{ flex: 1 }}>Recolour</span>
                    {(fx.tint || fx.invert) && (
                      <button onClick={() => setImageFx({ tint: null, invert: false })}
                        className="btn btn-secondary btn-sm">Reset</button>
                    )}
                  </div>
                  <div className="body-sm text-subtle">
                    Invert flips a flat black logo to white. Recolour paints a cut-out logo one
                    colour and keeps its transparency.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

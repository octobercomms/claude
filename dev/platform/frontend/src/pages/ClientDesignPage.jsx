import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Canvas, FabricImage, Textbox, Rect } from 'fabric';
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
async function ensureFont(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;600;700;800&display=swap`;
  document.head.appendChild(link);
  try { await document.fonts.load(`700 24px "${name}"`); await document.fonts.ready; }
  catch { /* the face will fall back; nothing to recover */ }
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
  const [selected, setSelected] = useState(null);   // the selected fabric object
  const [layers, setLayers] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const canvasEl = useRef(null);
  const fc = useRef(null);            // the fabric canvas
  const pageRef = useRef(null);       // page id the canvas currently holds
  const dirtyRef = useRef(false);

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
      .then(r => setAssets((Array.isArray(r) ? r : (r?.items || [])).filter(a => a.url)))
      .catch(() => setAssets([]));
  }, [clientId]);

  useEffect(() => {
    if (!openId) { setProject(null); return; }
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

  useEffect(() => {
    if (!project || !canvasEl.current) return undefined;
    const c = new Canvas(canvasEl.current, {
      width: project.width,
      height: project.height,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,   // selecting a layer must not raise it
    });
    fc.current = c;
    for (const ev of ['object:added', 'object:modified', 'object:removed', 'text:changed']) {
      c.on(ev, () => { markDirty(); syncLayers(); });
    }
    for (const ev of ['selection:created', 'selection:updated', 'selection:cleared']) {
      c.on(ev, syncLayers);
    }
    return () => { c.dispose(); fc.current = null; };
  }, [project, markDirty, syncLayers]);

  // Put a page's scene on the canvas. Fonts are loaded first: a text layer
  // rendered before its face arrives measures at the fallback's metrics and
  // wraps in the wrong place.
  const showPage = useCallback(async (id) => {
    const c = fc.current;
    const page = project?.pages?.find(p => p.id === id);
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
  }, [project, syncLayers]);

  useEffect(() => { if (pageId) showPage(pageId); }, [pageId, showPage]);

  // ── saving ─────────────────────────────────────────────────────────────────

  const save = useCallback(async ({ quiet = true } = {}) => {
    const c = fc.current;
    const id = pageRef.current;
    if (!c || !id) return;
    setSaving(true);
    try {
      // A postage stamp for the page strip, not a copy of the artwork.
      const thumbnail = c.toDataURL({ format: 'png', multiplier: 220 / Math.max(c.width, 1) });
      await api.put(`/design/pages/${id}`, { scene: c.toJSON(), thumbnail });
      dirtyRef.current = false; setDirty(false);
      setProject(p => p && ({ ...p, pages: p.pages.map(pg => pg.id === id ? { ...pg, thumbnail } : pg) }));
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
  }, [project]);

  async function goToPage(id) {
    if (id === pageId) return;
    if (dirtyRef.current) await save();
    setPageId(id);
  }

  // ── editing ────────────────────────────────────────────────────────────────

  async function addImage(url, { fill = false } = {}) {
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
        img.set({ scaleX: s, scaleY: s, left: c.width * 0.08, top: c.height * 0.08 });
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

  async function uploadAsset(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'product_image');
    fd.append('name', file.name);
    try {
      const a = await api.postForm(`/brand/clients/${clientId}/assets`, fd);
      setAssets(prev => [a, ...prev]);
      if (a.url) addImage(a.url, { fill: true });
    } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
  }

  const act = (fn) => () => { const c = fc.current; const o = c?.getActiveObject(); if (c && o) { fn(c, o); c.renderAll(); markDirty(); syncLayers(); } };
  const raise = act((c, o) => c.bringObjectForward(o));
  const lower = act((c, o) => c.sendObjectBackwards(o));
  const toFront = act((c, o) => c.bringObjectToFront(o));
  const toBack = act((c, o) => c.sendObjectToBack(o));
  const remove = act((c, o) => { c.remove(o); c.discardActiveObject(); });

  function setProp(key, value) {
    const c = fc.current; const o = c?.getActiveObject();
    if (!c || !o) return;
    o.set(key, value); c.renderAll(); markDirty(); setSelected(null); setSelected(o);
  }

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
                <div onClick={() => open(p.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') open(p.id); }}
                  style={{ cursor: 'pointer', aspectRatio: `${p.width}/${p.height}`, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.cover
                    ? <img src={p.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span className="body-sm text-subtle">Empty</span>}
                </div>
                <div style={{ fontWeight: 700, marginTop: 'var(--s2)' }}>{p.name}</div>
                <div className="body-sm text-subtle">{p.page_count} page{p.page_count === 1 ? '' : 's'} · {p.width}×{p.height}</div>
                <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                  <button onClick={() => duplicateProject(p)} className="btn btn-secondary btn-sm">Duplicate</button>
                  <button onClick={() => deleteProject(p)} className="btn btn-secondary btn-sm">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isText = selected && (selected.type === 'textbox' || selected.type === 'Textbox');
  const fit = Math.min(620 / project.width, 620 / project.height, 1);

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
          <div className="body-sm text-subtle" style={{ marginBottom: 'var(--s2)' }}>Click to place. Shift-click fills the page.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)', maxHeight: 300, overflowY: 'auto' }}>
            {assets.map(a => (
              <img key={a.id} src={a.url} alt={a.name} title={`${a.name} — shift-click to fill the page`}
                onClick={e => addImage(a.url, { fill: e.shiftKey })}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', cursor: 'pointer', padding: 2 }} />
            ))}
            {!assets.length && <span className="body-sm text-subtle">Nothing uploaded yet.</span>}
          </div>
        </div>

        {/* middle: the canvas */}
        <div>
          <div style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--r-md)', padding: 'var(--s4)', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: project.width * fit, height: project.height * fit, overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,.18)' }}>
              <div style={{ transform: `scale(${fit})`, transformOrigin: 'top left' }}>
                <canvas ref={canvasEl} />
              </div>
            </div>
          </div>

          {/* pages */}
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {project.pages.map((pg, i) => (
              <div key={pg.id} style={{ textAlign: 'center' }}>
                <div onClick={() => goToPage(pg.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') goToPage(pg.id); }}
                  style={{
                    width: 64, aspectRatio: `${project.width}/${project.height}`, cursor: 'pointer',
                    border: `var(--border-w) solid ${pg.id === pageId ? 'var(--accent)' : 'var(--card-border)'}`,
                    borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface)',
                  }}>
                  {pg.thumbnail && <img src={pg.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div className="body-sm text-subtle">{i + 1}</div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <button onClick={() => duplicatePage(pg.id)} title="Duplicate this page" className="btn btn-secondary btn-sm" style={{ padding: '0 var(--s2)' }}>⧉</button>
                  {project.pages.length > 1 && (
                    <button onClick={() => deletePage(pg.id)} title="Delete this page" className="btn btn-secondary btn-sm" style={{ padding: '0 var(--s2)' }}>×</button>
                  )}
                </div>
              </div>
            ))}
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
                <button onClick={remove} title="Delete layer" className="btn btn-secondary btn-sm">🗑</button>
              </div>

              {isText && (
                <div style={{ marginTop: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                  <select className="input" value={selected.fontFamily || 'Brockmann'}
                    onChange={async e => { await ensureFont(e.target.value); setProp('fontFamily', e.target.value); }}>
                    {FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                  <div className="row" style={{ gap: 'var(--s2)' }}>
                    <input className="input" type="number" min="8" max="400" value={Math.round(selected.fontSize || 48)}
                      onChange={e => setProp('fontSize', parseInt(e.target.value, 10) || 48)} style={{ width: 80 }} title="Size" />
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
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

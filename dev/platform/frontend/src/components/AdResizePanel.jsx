import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Loading overlay while the resize runs — rotating status like the concept
// generator, but with copy that fits this job.
function ResizingModal({ count }) {
  const steps = [
    'Checking the source resolution…',
    'Upscaling if it needs it…',
    'Expanding the background to each shape…',
    'Stitching the edges seamlessly…',
    'Rendering the final sizes…',
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % steps.length), 3500);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sm)', width: '100%', maxWidth: 420, textAlign: 'center', padding: '40px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 20 }}>Resizing your image</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, minHeight: 20 }}>{steps[i]}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 14, lineHeight: 1.5 }}>
          {count ? `Making ${count} size${count === 1 ? '' : 's'}. ` : ''}Each expand takes a few seconds — the sizes appear here as soon as they're ready.
        </div>
      </div>
    </div>
  );
}

// Resize for ads — drop one image, reshape it into the standard paid-social +
// display sizes. The background is generatively expanded so nothing gets cropped,
// and a too-small source is upscaled first. Backend does the fal work; this is
// upload → pick sizes → download.
export default function AdResizePanel({ clientId, clientName }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [groups, setGroups] = useState([]);
  const [prices, setPrices] = useState({ expand: 0.05, upscale: 0.03 });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dims, setDims] = useState(null);           // { w, h } natural source dims
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    api.get(`/ad-creatives/clients/${clientId}/ad-sizes`)
      .then(r => { setGroups(r.groups || []); if (r.prices) setPrices(r.prices); })
      .catch(() => {});
  }, [clientId]);

  function pickFile(f) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
    setFile(f);
    setResult(null);
    const url = URL.createObjectURL(f);
    setPreview(url);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }

  const allKeys = useMemo(() => groups.flatMap(g => g.sizes.map(s => s.key)), [groups]);
  function toggle(key) {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleFamily(g) {
    const keys = g.sizes.map(s => s.key);
    const allOn = keys.every(k => selected.has(k));
    setSelected(prev => { const n = new Set(prev); keys.forEach(k => allOn ? n.delete(k) : n.add(k)); return n; });
  }
  function toggleAll() {
    setSelected(prev => (prev.size === allKeys.length ? new Set() : new Set(allKeys)));
  }

  // Cost estimate: an expand call per selected size whose ratio differs from the
  // source, plus one upscale if the source looks too small for the biggest pick.
  const estimate = useMemo(() => {
    if (!selected.size) return null;
    const picked = groups.flatMap(g => g.sizes).filter(s => selected.has(s.key));
    let expandN = picked.length, upscale = 0;
    if (dims) {
      const sr = dims.w / dims.h;
      expandN = picked.filter(s => Math.abs((s.w / s.h) - sr) / (s.w / s.h) >= 0.012).length;
      const maxEdge = Math.max(...picked.map(s => Math.max(s.w, s.h)));
      const srcLong = Math.max(dims.w, dims.h);
      if (srcLong < maxEdge && srcLong < 3000 && maxEdge >= 800) upscale = 1;
    }
    return { cost: +(expandN * prices.expand + upscale * prices.upscale).toFixed(2), expandN, upscale };
  }, [selected, groups, dims, prices]);

  async function run() {
    if (!file) { toast('Upload an image first.', 'error'); return; }
    if (!selected.size) { toast('Pick at least one ad size.', 'error'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('sizes', JSON.stringify([...selected]));
      const out = await api.postForm(`/ad-creatives/clients/${clientId}/resize`, fd);
      setResult(out);
      const ok = (out.outputs || []).filter(o => !o.error).length;
      const bad = (out.outputs || []).length - ok;
      toast(`${ok} size${ok === 1 ? '' : 's'} ready${bad ? ` · ${bad} failed` : ''}`, bad ? 'error' : 'success');
    } catch (err) {
      toast(err.message || 'Resize failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const selCount = selected.size;

  return (
    <div className="stack stack-lg">
      <div>
        <h2 className="h2" style={{ marginBottom: 4 }}>Resize for ads</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 640, margin: 0 }}>
          Drop in one image and get it back in every ad size you need. The background is
          expanded to fit each shape — nothing gets cropped — and a small image is
          upscaled first so it stays sharp.
        </p>
      </div>

      {/* Upload */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`,
          borderRadius: 'var(--r-md)', padding: preview ? 16 : 40, textAlign: 'center',
          cursor: 'pointer', background: dragOver ? 'var(--surface-hover, var(--surface))' : 'var(--surface)',
          transition: 'border-color .15s',
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => pickFile(e.target.files?.[0])} />
        {preview ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', textAlign: 'left', flexWrap: 'wrap' }}>
            <img src={preview} alt="source" style={{ maxHeight: 120, maxWidth: 200, borderRadius: 'var(--r-sm)', objectFit: 'contain', background: '#00000008' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{file?.name}</div>
              {dims && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{dims.w}×{dims.h}px</div>}
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>Click to choose a different image</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Drop an image here, or click to choose</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>PNG or JPG · any size</div>
          </>
        )}
      </div>

      {/* Size picker */}
      {groups.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Ad sizes {selCount ? `· ${selCount} selected` : ''}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleAll}>
              {selected.size === allKeys.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {groups.map(g => {
              const keys = g.sizes.map(s => s.key);
              const allOn = keys.every(k => selected.has(k));
              return (
                <div key={g.family} style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 12, background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{g.family}</div>
                    <button onClick={() => toggleFamily(g)}
                      style={{ border: 'none', background: 'none', color: 'var(--accent, var(--text))', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                      {allOn ? 'None' : 'All'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.sizes.map(s => (
                      <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '3px 0' }}>
                        <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                        <span style={{ flex: 1 }}>{s.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{s.dims}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || !file || !selCount} onClick={run}>
          {busy ? 'Resizing…' : `Resize into ${selCount || 0} size${selCount === 1 ? '' : 's'}`}
        </button>
        {estimate && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Est. ~${estimate.cost.toFixed(2)}
            {estimate.upscale ? ' · upscales first' : ''}
            {dims && estimate.expandN < selCount ? ` · ${selCount - estimate.expandN} exact-shape (free)` : ''}
          </span>
        )}
      </div>

      {/* Results */}
      {result && (
        <div>
          {result.source?.upscaled && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Source upscaled from {result.source.width}×{result.source.height} →{' '}
              {result.source.upscaled_to?.width}×{result.source.upscaled_to?.height} for sharpness.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
            {(result.outputs || []).map(o => (
              <div key={o.key} style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface)' }}>
                <div style={{ aspectRatio: `${o.w} / ${o.h}`, background: '#00000008', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: 220 }}>
                  {o.error
                    ? <div style={{ padding: 12, fontSize: 12, color: 'var(--negative)', textAlign: 'center' }}>{o.error}</div>
                    : <img src={o.url} alt={o.label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{o.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '2px 0 8px' }}>
                    {o.family} · {o.dims}
                    {o.method === 'expanded' && <span> · expanded</span>}
                  </div>
                  {!o.error && (
                    <a className="btn btn-secondary btn-sm" href={o.url}
                      download={`${clientName ? clientName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' : ''}${o.key}.png`}
                      style={{ width: '100%', textAlign: 'center', display: 'block', boxSizing: 'border-box' }}>
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {busy && <ResizingModal count={selCount} />}
    </div>
  );
}

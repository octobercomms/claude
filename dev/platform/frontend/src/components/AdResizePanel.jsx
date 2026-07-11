import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Loading overlay while the resize runs — rotating status like the concept
// generator, but with copy that fits this job.
function ResizingModal({ count, images }) {
  const steps = [
    'Checking the source resolution…',
    'Upscaling anything too small…',
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
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 20 }}>Resizing your {images > 1 ? `${images} images` : 'image'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, minHeight: 20 }}>{steps[i]}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 14, lineHeight: 1.5 }}>
          {count ? `Making ${count} image${count === 1 ? '' : 's'} in all. ` : ''}Each expand takes a few seconds — they appear here as soon as they're ready.
        </div>
      </div>
    </div>
  );
}

let _uid = 0;

// Resize for ads — drop in one or many images, reshape each into the standard
// paid-social + display sizes. The background is generatively expanded so
// nothing gets cropped, and a too-small source is upscaled first. Backend does
// the fal work; this is upload → pick sizes → download.
export default function AdResizePanel({ clientId, clientName }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [groups, setGroups] = useState([]);
  const [prices, setPrices] = useState({ expand: 0.05, upscale: 0.03 });
  const [items, setItems] = useState([]);           // [{ id, file, url, dims }]
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    api.get(`/ad-creatives/clients/${clientId}/ad-sizes`)
      .then(r => { setGroups(r.groups || []); if (r.prices) setPrices(r.prices); })
      .catch(() => {});
  }, [clientId]);

  // Revoke object URLs on unmount.
  useEffect(() => () => { items.forEach(it => URL.revokeObjectURL(it.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    const rejected = Array.from(fileList || []).length - incoming.length;
    if (rejected) toast(`${rejected} non-image file${rejected === 1 ? '' : 's'} skipped.`, 'error');
    if (!incoming.length) return;
    setResult(null);
    const next = incoming.map(f => {
      const url = URL.createObjectURL(f);
      const item = { id: ++_uid, file: f, url, dims: null };
      const img = new Image();
      img.onload = () => setItems(prev => prev.map(x => x.id === item.id ? { ...x, dims: { w: img.naturalWidth, h: img.naturalHeight } } : x));
      img.src = url;
      return item;
    });
    setItems(prev => [...prev, ...next].slice(0, 25));
  }
  function removeItem(id) {
    setItems(prev => {
      const it = prev.find(x => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter(x => x.id !== id);
    });
  }
  function clearAll() {
    items.forEach(it => URL.revokeObjectURL(it.url));
    setItems([]); setResult(null);
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

  // Cost estimate: summed across every uploaded image — one expand call per
  // selected size whose ratio differs from that image, plus one upscale per
  // image that looks too small for the biggest pick.
  const estimate = useMemo(() => {
    if (!selected.size || !items.length) return null;
    const picked = groups.flatMap(g => g.sizes).filter(s => selected.has(s.key));
    if (!picked.length) return null;
    const maxEdge = Math.max(...picked.map(s => Math.max(s.w, s.h)));
    let expandN = 0, upscale = 0;
    for (const it of items) {
      if (it.dims) {
        const sr = it.dims.w / it.dims.h;
        expandN += picked.filter(s => Math.abs((s.w / s.h) - sr) / (s.w / s.h) >= 0.012).length;
        const srcLong = Math.max(it.dims.w, it.dims.h);
        if (srcLong < maxEdge && srcLong < 3000 && maxEdge >= 800) upscale += 1;
      } else {
        expandN += picked.length;   // unknown dims — assume all need an expand
      }
    }
    return { cost: +(expandN * prices.expand + upscale * prices.upscale).toFixed(2), upscale };
  }, [selected, groups, items, prices]);

  async function run() {
    if (!items.length) { toast('Upload at least one image first.', 'error'); return; }
    if (!selected.size) { toast('Pick at least one ad size.', 'error'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      items.forEach(it => fd.append('files', it.file));
      fd.append('sizes', JSON.stringify([...selected]));
      const out = await api.postForm(`/ad-creatives/clients/${clientId}/resize`, fd);
      setResult(out);
      const resItems = out.items || [];
      const okImages = resItems.filter(it => !it.error).length;
      const okSizes = resItems.reduce((n, it) => n + (it.outputs || []).filter(o => !o.error).length, 0);
      const failImages = resItems.length - okImages;
      toast(`${okSizes} size${okSizes === 1 ? '' : 's'} across ${okImages} image${okImages === 1 ? '' : 's'}${failImages ? ` · ${failImages} image${failImages === 1 ? '' : 's'} failed` : ''}`, failImages ? 'error' : 'success');
    } catch (err) {
      toast(err.message || 'Resize failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const selCount = selected.size;
  const totalOutputs = items.length * selCount;
  const stem = clientName ? clientName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' : '';
  const nameStem = n => String(n || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return (
    <div className="stack stack-lg">
      <div>
        <h2 className="h2" style={{ marginBottom: 4 }}>Resize for ads</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 640, margin: 0 }}>
          Drop in one image or a whole batch and get each one back in every ad size you need. The
          background is expanded to fit each shape — nothing gets cropped — and a small image is
          upscaled first so it stays sharp.
        </p>
      </div>

      {/* Upload */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`,
          borderRadius: 'var(--r-md)', padding: items.length ? 16 : 40, textAlign: 'center',
          cursor: 'pointer', background: dragOver ? 'var(--surface-hover, var(--surface))' : 'var(--surface)',
          transition: 'border-color .15s',
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        {items.length ? (
          <div onClick={e => e.stopPropagation()} style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {items.map(it => (
                <div key={it.id} style={{ position: 'relative', width: 96 }}>
                  <img src={it.url} alt={it.file.name} style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 'var(--r-sm)', background: '#00000008', border: 'var(--border-w) solid var(--card-border)' }} />
                  <button onClick={() => removeItem(it.id)} title="Remove"
                    style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--text)', color: '#fff', fontSize: 13, lineHeight: '22px', cursor: 'pointer', padding: 0 }}>×</button>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.file.name}</div>
                  {it.dims && <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{it.dims.w}×{it.dims.h}</div>}
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()}
                style={{ width: 96, height: 96, borderRadius: 'var(--r-sm)', border: '2px dashed var(--card-border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit' }}>
                + Add
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{items.length} image{items.length === 1 ? '' : 's'} · up to 25</span>
              <button className="btn btn-secondary btn-sm" onClick={clearAll}>Clear all</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Drop images here, or click to choose</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>PNG or JPG · one or many · any size</div>
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
        <button className="btn btn-primary" disabled={busy || !items.length || !selCount} onClick={run}>
          {busy ? 'Resizing…' : `Resize ${items.length || 0} image${items.length === 1 ? '' : 's'} into ${selCount || 0} size${selCount === 1 ? '' : 's'}`}
        </button>
        {totalOutputs > 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalOutputs} output{totalOutputs === 1 ? '' : 's'}</span>}
        {estimate && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Est. ~${estimate.cost.toFixed(2)}{estimate.upscale ? ` · ${estimate.upscale} upscale${estimate.upscale === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </div>

      {/* Results — one section per source image */}
      {result && (result.items || []).map((it, idx) => (
        <div key={idx}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 className="h3" style={{ margin: 0 }}>{it.name || `Image ${idx + 1}`}</h3>
            {it.source?.upscaled && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                upscaled {it.source.width}×{it.source.height} → {it.source.upscaled_to?.width}×{it.source.upscaled_to?.height}
              </span>
            )}
          </div>
          {it.error ? (
            <div className="text-negative" style={{ fontSize: 13, marginBottom: 8 }}>{it.error}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              {(it.outputs || []).map(o => (
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
                        download={`${stem}${nameStem(it.name)}-${o.key}.png`}
                        style={{ width: '100%', textAlign: 'center', display: 'block', boxSizing: 'border-box' }}>
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {busy && <ResizingModal count={totalOutputs} images={items.length} />}
    </div>
  );
}

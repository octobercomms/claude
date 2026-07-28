import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

// Stills → Reel. Drop 2–12 client stills, pick a camera motion, and each image
// is animated into a short cinematic clip (fal image-to-video) then stitched
// into one vertical reel on our own servers. Lands in the Edit history like any
// other job; the parent polls status and shows the finished reel.

let _uid = 0;

const MOTION_LABELS = {
  'push-in': 'Push in',
  'drift': 'Drift across',
  'reveal': 'Reveal (zoom out)',
  'orbit': 'Orbit',
  'rise': 'Rise / tilt up',
  'subtle': 'Subtle',
};
const ASPECT_DIMS = { '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };

export default function StillsReelPanel({ clientId, onSubmitted }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [images, setImages] = useState([]);        // [{ id, file, url }]
  const [dragOver, setDragOver] = useState(false);
  const [motion, setMotion] = useState('push-in');
  const [aspect, setAspect] = useState('9:16');
  const [perClip, setPerClip] = useState(1.2);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({ motions: Object.keys(MOTION_LABELS), aspects: ['9:16', '1:1', '4:5'], price_per_clip: 0.30 });

  useEffect(() => {
    api.get('/edit/stills-reel/options').then(setOpts).catch(() => {});
    return () => setImages(prev => { prev.forEach(i => URL.revokeObjectURL(i.url)); return []; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(fileList) {
    const picked = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    setImages(prev => {
      const room = Math.max(0, 12 - prev.length);
      const next = picked.slice(0, room).map(f => ({ id: ++_uid, file: f, url: URL.createObjectURL(f) }));
      if (picked.length > room) toast('A reel takes up to 12 images.', 'info');
      return [...prev, ...next];
    });
  }
  function removeImg(id) {
    setImages(prev => { const i = prev.find(x => x.id === id); if (i) URL.revokeObjectURL(i.url); return prev.filter(x => x.id !== id); });
  }
  function move(id, dir) {
    setImages(prev => {
      const i = prev.findIndex(x => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  }

  const estimate = (images.length * (opts.price_per_clip || 0.30));
  const reelSeconds = (images.length * perClip);

  async function build() {
    if (images.length < 2) { toast('Add at least 2 images.', 'error'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      images.forEach(i => fd.append('images', i.file));
      fd.append('motion', motion);
      fd.append('aspect', aspect);
      fd.append('per_clip_seconds', String(perClip));
      await api.postForm(`/edit/clients/${clientId}/stills-reel`, fd);
      setImages(prev => { prev.forEach(i => URL.revokeObjectURL(i.url)); return []; });
      toast('Building your reel — it’ll appear in history below.', 'success');
      onSubmitted?.();
    } catch (e) {
      toast(`Couldn’t start the reel: ${e.message}`, 'error');
    } finally { setBusy(false); }
  }

  const [aw, ah] = ASPECT_DIMS[aspect] || [9, 16];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />

      {images.length === 0 ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`, borderRadius: 'var(--r-md)', padding: 64, textAlign: 'center', cursor: 'pointer', background: 'var(--surface)' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Drop 2–12 images, or click to choose</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>Each still is animated into a short cinematic clip, then stitched into one reel</div>
        </div>
      ) : (
        <div className="edit-split"
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>

          {/* LEFT — the stills, in reel order */}
          <div>
            <div className="card">
              <div className="caption mb-3">Stills — animated in this order</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {images.map((im, i) => (
                  <div key={im.id} style={{ position: 'relative', borderRadius: 'var(--r-sm)', overflow: 'hidden', border: 'var(--border-w) solid var(--card-border)', aspectRatio: `${aw} / ${ah}`, background: '#000' }}>
                    <img src={im.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.7)', color: '#fff', fontWeight: 800, fontSize: 11, borderRadius: 3, padding: '1px 6px' }}>{i + 1}</span>
                    <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button className="btn btn-secondary btn-sm" disabled={i === 0} onClick={() => move(im.id, -1)} style={{ padding: '0 6px' }} title="Earlier">←</button>
                      <button className="btn btn-secondary btn-sm" disabled={i === images.length - 1} onClick={() => move(im.id, 1)} style={{ padding: '0 6px' }} title="Later">→</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => removeImg(im.id)} style={{ padding: '0 6px', color: 'var(--negative)' }} title="Remove">×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => fileRef.current?.click()} disabled={images.length >= 12}>+ Add still</button>
          </div>

          {/* RIGHT — settings */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 }}>
            <div>
              <label className="caption" style={{ display: 'block', marginBottom: 6 }}>Camera motion</label>
              <select value={motion} onChange={e => setMotion(e.target.value)} className="input" style={{ width: '100%' }}>
                {(opts.motions || Object.keys(MOTION_LABELS)).map(m => <option key={m} value={m}>{MOTION_LABELS[m] || m}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>Applied to every still — subtle moves montage best.</div>
            </div>

            <div>
              <label className="caption" style={{ display: 'block', marginBottom: 6 }}>Shape</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(opts.aspects || ['9:16', '1:1', '4:5']).map(a => (
                  <button key={a} className={`btn btn-sm ${aspect === a ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAspect(a)} style={{ flex: 1 }}>{a}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="caption" style={{ display: 'block', marginBottom: 6 }}>Each clip: {perClip.toFixed(1)}s</label>
              <input type="range" min="0.6" max="4" step="0.1" value={perClip} onChange={e => setPerClip(Number(e.target.value))} style={{ width: '100%' }} />
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>Reel length ~{reelSeconds.toFixed(1)}s across {images.length} clip{images.length === 1 ? '' : 's'}.</div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: 10 }}>
              Animating {images.length} still{images.length === 1 ? '' : 's'} · est. <strong>${estimate.toFixed(2)}</strong> in fal render spend. Runs in the background — you can leave this page.
            </div>

            <button className="btn btn-primary" onClick={build} disabled={busy || images.length < 2}>
              {busy ? 'Starting…' : `Build reel from ${images.length} still${images.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

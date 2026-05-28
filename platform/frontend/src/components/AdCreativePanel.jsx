import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { primaryBtn, secondaryBtn, dangerBtn, COLORS } from '../styles/theme';

// Ad Creative panel on the Paid page. Generates batches of ad concepts
// (headline + body + CTA + visual direction) using Claude, then renders
// image variants per concept across multiple aspect ratios so the AM can
// roll out to any placement.
export default function AdCreativePanel({ clientId, clientName }) {
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [assets, setAssets] = useState([]);
  const [showBrief, setShowBrief] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function refresh() {
    const [bs, as] = await Promise.all([
      api.get(`/ad-creatives/clients/${clientId}/batches`),
      api.get(`/brand/clients/${clientId}/assets`),
    ]);
    setBatches(bs);
    setAssets(as);
    if (bs.length && !activeBatchId) {
      setActiveBatchId(bs[0].id);
      const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${bs[0].id}`);
      setCreatives(cs);
    }
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function selectBatch(batchId) {
    setActiveBatchId(batchId);
    const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${batchId}`);
    setCreatives(cs);
  }

  async function generate(payload) {
    setGenerating(true);
    try {
      const { batch, creatives: newCreatives } = await api.post(`/ad-creatives/clients/${clientId}/generate`, payload);
      setBatches([batch, ...batches]);
      setActiveBatchId(batch.id);
      // Re-fetch with images shape (newCreatives doesn't include images aggregation)
      const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${batch.id}`);
      setCreatives(cs);
      setShowBrief(false);
      toast(`Generated ${newCreatives.length} ad concepts.`, 'success');
    } catch (e) {
      toast(`Generation failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function deleteCreative(creativeId) {
    if (!confirm('Delete this concept?')) return;
    try {
      await api.delete(`/ad-creatives/creatives/${creativeId}`);
      setCreatives(prev => prev.filter(c => c.id !== creativeId));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function deleteBatch(batchId) {
    if (!confirm('Delete this batch and all its concepts?')) return;
    try {
      await api.delete(`/ad-creatives/batches/${batchId}`);
      const next = batches.filter(b => b.id !== batchId);
      setBatches(next);
      if (next[0]) selectBatch(next[0].id);
      else { setActiveBatchId(null); setCreatives([]); }
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function renderImages(creativeId, payload) {
    try {
      const { images } = await api.post(`/ad-creatives/creatives/${creativeId}/images`, payload);
      // Optimistic merge — append new image objects on the matching creative.
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: [...(c.images || []), ...images.filter(i => !i.error)] }
        : c));
      const errors = images.filter(i => i.error);
      if (errors.length) toast(`Some renders failed: ${errors.map(e => `${e.aspect_ratio}: ${e.error}`).join('; ')}`, 'error');
    } catch (e) {
      toast(`Image render failed: ${e.message}`, 'error');
    }
  }

  async function deleteImage(imageId, creativeId) {
    try {
      await api.delete(`/ad-creatives/images/${imageId}`);
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: (c.images || []).filter(i => i.id !== imageId) }
        : c));
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'error');
    }
  }

  // Adobe Photoshop generative resize — take one image we already have
  // and ask Adobe to produce versions in every other aspect ratio. The
  // result returns as new image rows on the same creative.
  async function fanOutImage(imageId, creativeId) {
    try {
      const { generated } = await api.post(`/ad-creatives/images/${imageId}/fan-out`, {
        aspect_ratios: ['1:1', '4:5', '9:16', '16:9'],
      });
      const added = generated.filter(g => !g.error && g.id);
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: [...(c.images || []), ...added] }
        : c));
      const errs = generated.filter(g => g.error);
      if (errs.length) toast(`Some sizes failed: ${errs.map(e => `${e.aspect_ratio}: ${e.error}`).join('; ')}`, 'error');
      else toast(`Fanned out to ${added.length} new sizes via Adobe.`, 'success');
    } catch (e) {
      toast(`Fan-out failed: ${e.message}`, 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Ad Creative — {clientName}</h1>
          <p style={{ fontSize: 13, color: '#666', margin: '4px 0 0', maxWidth: 760, lineHeight: 1.5 }}>
            Generate batches of ad concepts using direct-response frameworks (PAS, AIDA, Before/After…),
            grounded in the brand assets and the brief you supply. Then render image variants per concept
            across any aspect ratios you need — 1:1, 4:5, 9:16, 16:9.
          </p>
        </div>
        <button style={primaryBtn} onClick={() => setShowBrief(true)} disabled={generating}>
          {generating ? 'Generating…' : 'Generate ad concepts'}
        </button>
      </div>

      {!assets.length && (
        <div style={{ background: '#fffceb', border: '1px solid #f0d260', padding: 12, borderRadius: 6, fontSize: 12, color: '#5d4000', marginBottom: 16 }}>
          No brand assets uploaded yet — visit the <strong>Brand</strong> tab on the sidebar and add logos, product photos, palette
          and guidelines so generations look on-brand.
        </div>
      )}

      {showBrief && (
        <BriefModal
          assets={assets}
          submitting={generating}
          onClose={() => setShowBrief(false)}
          onSubmit={generate}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22, marginTop: 18 }}>
        <div>
          <div style={styles.h3}>Past batches</div>
          {!batches.length && <div style={{ color: '#888', fontSize: 13 }}>Nothing yet — click Generate.</div>}
          {batches.map(b => (
            <div key={b.id} style={{ ...styles.batchRow, ...(b.id === activeBatchId ? styles.batchRowActive : {}) }} onClick={() => selectBatch(b.id)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{b.creative_count} concepts · {b.platform}</div>
              {b.brief && <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.4 }}>{b.brief.slice(0, 64)}{b.brief.length > 64 ? '…' : ''}</div>}
              {b.id === activeBatchId && (
                <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} style={{ ...dangerBtn, padding: '3px 10px', fontSize: 11, marginTop: 6 }}>Delete batch</button>
              )}
            </div>
          ))}
        </div>

        <div>
          {!creatives.length && <div style={{ color: '#888', padding: 20 }}>Pick a batch, or generate a new one.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {creatives.map(c => (
              <CreativeCard key={c.id} creative={c}
                onDelete={() => deleteCreative(c.id)}
                onRender={(payload) => renderImages(c.id, payload)}
                onDeleteImage={(imgId) => deleteImage(imgId, c.id)}
                onFanOut={(imgId) => fanOutImage(imgId, c.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefModal({ assets, submitting, onClose, onSubmit }) {
  const [brief, setBrief] = useState('');
  const [platform, setPlatform] = useState('meta');
  const [count, setCount] = useState(8);
  const [selectedAssets, setSelectedAssets] = useState(() => new Set(assets.map(a => a.id)));

  function toggle(id) {
    setSelectedAssets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Generate ad concepts</h2>
        <label style={modalStyles.label}>Brief</label>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={4} style={modalStyles.textarea}
          placeholder="e.g. We're launching a new mug colour next week — UK + US targets, emphasise the studio kitchens crowd. Avoid heavy discount language." />

        <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={modalStyles.label}>Platform</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)} style={modalStyles.input}>
              <option value="meta">Meta (Facebook / Instagram)</option>
              <option value="google">Google</option>
              <option value="tiktok">TikTok</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label style={modalStyles.label}>Concepts</label>
            <input type="number" min="4" max="16" value={count} onChange={e => setCount(parseInt(e.target.value) || 8)} style={modalStyles.input} />
          </div>
        </div>

        <label style={modalStyles.label}>Brand assets to include as reference</label>
        {!assets.length && <div style={{ fontSize: 12, color: '#888' }}>No brand assets uploaded yet.</div>}
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
          {assets.map(a => (
            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedAssets.has(a.id)} onChange={() => toggle(a.id)} />
              <span style={{ fontWeight: 600 }}>{a.name}</span>
              <span style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{a.kind.replace('_', ' ')}</span>
            </label>
          ))}
        </div>

        <div style={modalStyles.footer}>
          <button style={secondaryBtn} onClick={onClose}>Cancel</button>
          <button style={primaryBtn} onClick={() => onSubmit({ brief, platform, count, asset_ids: Array.from(selectedAssets) })} disabled={submitting}>
            {submitting ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreativeCard({ creative, onDelete, onRender, onDeleteImage, onFanOut }) {
  const [showRender, setShowRender] = useState(false);
  const [provider, setProvider] = useState('replicate');
  const [aspects, setAspects] = useState(new Set(['1:1']));
  const [styleBrief, setStyleBrief] = useState('');
  const [rendering, setRendering] = useState(false);

  function toggleAspect(a) {
    setAspects(prev => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  }

  async function go() {
    if (!aspects.size) return;
    setRendering(true);
    try {
      await onRender({ provider, aspect_ratios: Array.from(aspects), style_brief: styleBrief });
      setShowRender(false);
    } finally {
      setRendering(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={styles.framePill}>{creative.framework}</span>
          <span style={styles.anglePill}>{creative.angle}</span>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={styles.field}>HEADLINE</div>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: '#1a1a1a' }}>{creative.headline}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={styles.field}>BODY</div>
        <div style={{ fontSize: 13, color: '#333', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{creative.body}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={styles.field}>CTA</div>
        <div style={{ fontSize: 12, color: '#1a4f9c', fontWeight: 700 }}>{creative.cta}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={styles.field}>VISUAL CONCEPT</div>
        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{creative.visual_concept}</div>
      </div>

      {creative.notes && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#888', fontStyle: 'italic' }}>{creative.notes}</div>
      )}

      {(creative.images || []).length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {creative.images.map(img => (
            <ImageThumb key={img.id} img={img} onDelete={() => onDeleteImage(img.id)} onFanOut={onFanOut} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowRender(s => !s)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {showRender ? 'Cancel' : 'Render images'}
        </button>
      </div>

      {showRender && (
        <div style={{ marginTop: 10, padding: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
          <div style={styles.field}>PROVIDER</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['replicate', 'ideogram', 'adobe'].map(p => (
              <button key={p} onClick={() => setProvider(p)} type="button" style={provider === p ? styles.providerOn : styles.providerOff}>{p}</button>
            ))}
          </div>
          <div style={styles.field}>ASPECT RATIOS</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {['1:1', '4:5', '9:16', '16:9'].map(a => (
              <button key={a} onClick={() => toggleAspect(a)} type="button" style={aspects.has(a) ? styles.providerOn : styles.providerOff}>{a}</button>
            ))}
          </div>
          <input value={styleBrief} onChange={e => setStyleBrief(e.target.value)}
            placeholder="Optional style brief (e.g. 'editorial 35mm film')"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }} />
          <button onClick={go} style={{ ...primaryBtn, padding: '5px 14px', fontSize: 12 }} disabled={rendering || !aspects.size}>
            {rendering ? 'Rendering…' : `Render ${aspects.size} image${aspects.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  );
}

function ImageThumb({ img, onDelete, onFanOut }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <a href={img.url} target="_blank" rel="noreferrer">
        <img src={img.url} alt="" style={{ ...styles.thumb, ...aspectStyle(img.aspect_ratio) }} />
      </a>
      <div style={styles.thumbBadge}>{img.aspect_ratio}</div>
      <button onClick={onDelete} style={styles.thumbX}>×</button>
      {hovered && onFanOut && (
        <button onClick={() => onFanOut(img.id)} title="Adobe Photoshop generative resize — fan out to every other aspect ratio"
          style={styles.fanOutBtn}>↔</button>
      )}
    </div>
  );
}

function aspectStyle(ratio) {
  if (ratio === '9:16') return { width: 50, height: 88 };
  if (ratio === '4:5') return { width: 64, height: 80 };
  if (ratio === '16:9') return { width: 110, height: 62 };
  return { width: 78, height: 78 };
}

const styles = {
  h3: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  batchRow: { padding: 10, border: '1px solid #eee', borderRadius: 4, marginBottom: 8, cursor: 'pointer', background: '#fff' },
  batchRowActive: { background: '#fffceb', borderColor: COLORS.yellow },
  card: { padding: 14, background: '#fff', border: '1px solid #eee', borderRadius: 6 },
  field: { fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  framePill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#eef2ff', color: '#3949ab', textTransform: 'uppercase', letterSpacing: 0.4 },
  anglePill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#f4eafd', color: '#5e2d8c', textTransform: 'uppercase', letterSpacing: 0.4 },
  thumb: { objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' },
  thumbBadge: { position: 'absolute', bottom: 2, left: 2, padding: '1px 6px', background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 9, borderRadius: 3, fontWeight: 700, letterSpacing: 0.4 },
  thumbX: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '1px solid #ddd', cursor: 'pointer', fontSize: 12, lineHeight: 1, color: '#c62828' },
  fanOutBtn: { position: 'absolute', bottom: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: '#1a1a1a', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#fff', fontWeight: 700 },
  providerOn: { padding: '5px 12px', fontSize: 11, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', borderRadius: 999, fontWeight: 700 },
  providerOff: { padding: '5px 12px', fontSize: 11, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', borderRadius: 999 },
};

const modalStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 540, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 5 },
  input: { width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
const KINDS = [
  { value: 'logo',          label: 'Logo',         description: 'PNG, SVG, JPEG. Used as overlay reference and watermark.' },
  { value: 'product_image', label: 'Product image', description: 'Hero shots, lifestyle photography — used as visual reference for generation.' },
  { value: 'font',          label: 'Font',         description: 'WOFF, WOFF2, TTF. For Photoshop API overlays.' },
  { value: 'guideline',     label: 'Guideline',    description: 'Free-form brand-voice / do/don\'t notes — passed to Claude.' },
  { value: 'palette',       label: 'Palette',      description: 'Hex codes — passed to image generators as the brand colour reference.' },
  { value: 'b_roll_clip',   label: 'B-roll clip',  description: 'Short video clips (MP4/MOV) for Style E — buildings, project sites, walking shots. Bulk upload supported.' },
  { value: 'prop_image',    label: 'Prop image',   description: 'Photos for Style F — drawings, notebooks, material samples, hands holding objects. Bulk upload supported.' },
];

// `embedded` true means this page is rendered inside ClientDetailPage's
// Setup → Brand tab, where the parent owns the hero + tab strip. In
// that mode we drop our own hero so the AM doesn't see two "October
// Communications" overlines stacked on top of each other.
export default function ClientBrandPage({ embedded = false } = {}) {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [assets, setAssets] = useState([]);
  const [filter, setFilter] = useState('all');
  const [uploadingKind, setUploadingKind] = useState(null);
  const [showPaletteForm, setShowPaletteForm] = useState(false);
  const [showGuidelineForm, setShowGuidelineForm] = useState(false);
  const fileInputRef = useRef();

  async function refresh() {
    const [c, a] = await Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/brand/clients/${id}/assets`),
    ]);
    setClient(c);
    setAssets(a);
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [id]);

  async function handleFileUpload(file, kind, name) {
    if (!file) return;
    setUploadingKind(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      if (name) fd.append('name', name);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/brand/clients/${id}/assets`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast('Asset uploaded.', 'success');
      refresh();
    } catch (e) {
      toast(`Upload failed: ${e.message}`, 'error');
    } finally {
      setUploadingKind(null);
    }
  }

  // Bulk upload — used for the B-roll and prop banks where the AM may
  // be uploading 30+ files at once. Multipart with multiple files.
  async function handleBulkUpload(files, kind) {
    if (!files?.length) return;
    setUploadingKind(kind);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      for (const f of files) fd.append('files', f);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/brand/clients/${id}/assets/bulk`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const result = await res.json();
      toast(`Uploaded ${result.inserted?.length || 0} files.`, 'success');
      refresh();
    } catch (e) {
      toast(`Bulk upload failed: ${e.message}`, 'error');
    } finally {
      setUploadingKind(null);
    }
  }

  async function deleteAsset(asset) {
    if (!confirm(`Delete "${asset.name}"?`)) return;
    try {
      await api.delete(`/brand/assets/${asset.id}`);
      refresh();
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  const filtered = assets.filter(a => filter === 'all' ? true : a.kind === filter);
  const byKind = (k) => assets.filter(a => a.kind === k);

  return (
    <div className={embedded ? '' : 'suite-setup'}>
      {!embedded && (
        <>
          <div className="kicker"><span className="pip" />{client?.name && <span className="kicker-name">{client.name}</span>}</div>
          <header className="hero">
            <div>
              <h1 className="display mt-2"><span className="text-accent">Brand</span></h1>
            </div>
          </header>
        </>
      )}
      <p className="body mb-5">
        Upload the brand's logos, product photography, fonts, colour palette and voice guidelines.
        Both the Social and Ad Creative generators pull these as reference so output stays on-brand
        rather than AI-generic.
      </p>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All ({assets.length})</FilterChip>
        {KINDS.map(k => (
          <FilterChip key={k.value} active={filter === k.value} onClick={() => setFilter(k.value)}>
            {k.label} ({byKind(k.value).length})
          </FilterChip>
        ))}
      </div>

      {/* Upload buttons */}
      <div className="row wrap" style={{ marginBottom: 22, padding: 14, background: "var(--surface-raised)", border: "var(--border-w) solid var(--accent)", borderRadius: "var(--r-sm)" }}>
        <UploadButton label="+ Upload logo" disabled={uploadingKind === 'logo'} onPick={f => handleFileUpload(f, 'logo')} accept="image/*" />
        <UploadButton label="+ Upload product image" disabled={uploadingKind === 'product_image'} onPick={f => handleFileUpload(f, 'product_image')} accept="image/*" />
        <UploadButton label="+ Upload font" disabled={uploadingKind === 'font'} onPick={f => handleFileUpload(f, 'font')} accept=".woff,.woff2,.ttf,.otf" />
        <BulkUploadButton label="+ Bulk upload B-roll" disabled={uploadingKind === 'b_roll_clip'} onPick={files => handleBulkUpload(files, 'b_roll_clip')} accept="video/*" />
        <BulkUploadButton label="+ Bulk upload props" disabled={uploadingKind === 'prop_image'} onPick={files => handleBulkUpload(files, 'prop_image')} accept="image/*" />
        <button className="btn btn-secondary" onClick={() => setShowPaletteForm(true)}>+ Add palette</button>
        <button className="btn btn-secondary" onClick={() => setShowGuidelineForm(true)}>+ Add guideline</button>
      </div>

      {showPaletteForm && (
        <PaletteForm clientId={id} onClose={() => setShowPaletteForm(false)} onSaved={() => { setShowPaletteForm(false); refresh(); }} />
      )}
      {showGuidelineForm && (
        <GuidelineForm clientId={id} onClose={() => setShowGuidelineForm(false)} onSaved={() => { setShowGuidelineForm(false); refresh(); }} />
      )}

      {!filtered.length && (
        <div style={{ color: 'var(--text-subtle)', padding: 30, textAlign: 'center', border: '1px dashed #ddd', borderRadius: 6 }}>
          No assets yet — upload a logo or product image to get started.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {filtered.map(a => (
          <AssetCard key={a.id} asset={a} onDelete={() => deleteAsset(a)} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 12px', fontSize: 12, border: '1px solid ' + (active ? 'var(--text)' : 'var(--accent-soft)'),
      background: active ? 'var(--text)' : 'var(--surface)', color: active ? 'var(--surface)' : 'var(--text-muted)',
      cursor: 'pointer', borderRadius: 999, fontWeight: active ? 700 : 500,
    }}>{children}</button>
  );
}

function UploadButton({ label, onPick, accept, disabled }) {
  const ref = useRef();
  return (
    <>
      <button className="btn btn-secondary" onClick={() => ref.current?.click()} disabled={disabled}>
        {disabled ? 'Uploading…' : label}
      </button>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
    </>
  );
}

function BulkUploadButton({ label, onPick, accept, disabled }) {
  const ref = useRef();
  return (
    <>
      <button className="btn btn-secondary" onClick={() => ref.current?.click()} disabled={disabled}>
        {disabled ? 'Uploading…' : label}
      </button>
      <input ref={ref} type="file" accept={accept} multiple style={{ display: 'none' }}
        onChange={e => {
          const files = Array.from(e.target.files || []);
          if (files.length) onPick(files);
          e.target.value = '';
        }} />
    </>
  );
}

function AssetCard({ asset, onDelete }) {
  const mimetype = asset.metadata?.mimetype || '';
  const isVideo = mimetype.startsWith('video/') || asset.kind === 'b_roll_clip';
  const isImage = !isVideo && (mimetype.startsWith('image/') || asset.kind === 'logo' || asset.kind === 'product_image' || asset.kind === 'prop_image');
  const isPalette = asset.kind === 'palette';
  const isGuideline = asset.kind === 'guideline';
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ height: 140, background: 'var(--surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottom: '1px solid #eee' }}>
        {isVideo && asset.url && (
          <video src={asset.url} muted preload="metadata" style={{ maxHeight: '100%', maxWidth: '100%' }} onMouseEnter={e => e.target.play()} onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0; }} />
        )}
        {isImage && asset.url && (
          <img src={asset.url} alt={asset.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
        )}
        {isPalette && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            {(asset.metadata?.colors || []).slice(0, 6).map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} title={c} />
            ))}
          </div>
        )}
        {isGuideline && (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'left', overflow: 'hidden', maxHeight: '100%' }}>
            {(asset.metadata?.body || '').slice(0, 180)}…
          </div>
        )}
        {!isImage && !isVideo && !isPalette && !isGuideline && (
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>{asset.kind}</span>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{asset.kind.replace('_', ' ')}</div>
        <button onClick={onDelete} className="btn btn-danger btn-sm">Delete</button>
      </div>
    </div>
  );
}

function PaletteForm({ clientId, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [colors, setColors] = useState(['#000000', 'var(--surface)', 'var(--accent)']);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.post(`/brand/clients/${clientId}/assets/meta`, { kind: 'palette', name: name || 'Brand palette', metadata: { colors } });
      onSaved();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Add palette</h2>
        <label style={modalStyles.label}>Name</label>
        <input style={modalStyles.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Primary palette" />
        <label style={modalStyles.label}>Hex codes</label>
        {colors.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input type="color" value={c} onChange={e => { const next = [...colors]; next[i] = e.target.value; setColors(next); }} style={{ width: 40, height: 32 }} />
            <input value={c} onChange={e => { const next = [...colors]; next[i] = e.target.value; setColors(next); }} style={modalStyles.input} />
            <button onClick={() => setColors(colors.filter((_, j) => j !== i))} className="btn btn-secondary btn-sm">×</button>
          </div>
        ))}
        <button onClick={() => setColors([...colors, '#cccccc'])} className="btn btn-secondary btn-sm">+ Add colour</button>
        <div style={modalStyles.footer}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !colors.length}>{saving ? 'Saving…' : 'Save palette'}</button>
        </div>
      </div>
    </div>
  );
}

function GuidelineForm({ clientId, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api.post(`/brand/clients/${clientId}/assets/meta`, { kind: 'guideline', name: name || 'Brand voice', metadata: { body } });
      onSaved();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Add brand guideline</h2>
        <label style={modalStyles.label}>Name</label>
        <input style={modalStyles.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Voice & tone" />
        <label style={modalStyles.label}>Notes</label>
        <textarea style={{ ...modalStyles.input, minHeight: 140, resize: 'vertical', fontFamily: 'inherit' }} value={body} onChange={e => setBody(e.target.value)}
          placeholder="Brand voice, do's and don'ts, key messaging pillars, terminology to use or avoid…" />
        <div style={modalStyles.footer}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !body.trim()}>{saving ? 'Saving…' : 'Save guideline'}</button>
        </div>
      </div>
    </div>
  );
}

const modalStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000 },
  modal: { background: 'var(--accent-soft)', borderRadius: 14, width: '100%', maxWidth: 460, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 5 },
  input: { width: '100%', padding: '7px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

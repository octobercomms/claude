import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import StillsReelPanel from '../components/edit/StillsReelPanel';

// Edit — a guided video editor. Upload one clip (trim / clean audio / captions)
// or several (combined into one video first), rendered server-side with ffmpeg +
// Whisper. Nothing leaves October's box. Past edits are saved, renamable, and
// re-openable to tweak without re-uploading.

const WHISPER_PER_MIN = 0.006;
const ASS_SIZE = { small: 18, medium: 24, large: 30 };   // must match editProcessor
let _uid = 0;

function fmt(s) {
  if (s == null || isNaN(s)) return '—';
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
// Caption vertical margin in the 288-tall ASS canvas — mirrors editProcessor.
function marginVFor(pos) { return Math.min(250, Math.max(40, 40 + (pos || 0) * 200)); }

const ASPECTS = [
  { key: 'original', label: 'Original' },
  { key: '9:16', label: 'Reel 9:16' },
  { key: '1:1', label: 'Square 1:1' },
  { key: '4:5', label: 'Portrait 4:5' },
];
const AR_DIMS = { '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };

// Instagram UI regions to keep clear of key content. Fractions of a 9:16 frame.
function safeBoxes(mode) {
  const boxes = [
    { key: 'top', style: { top: 0, left: 0, right: 0, height: '9%' }, label: 'top bar' },
    { key: 'rail', style: { right: '1.5%', top: '40%', width: '17%', height: '42%' }, label: 'buttons' },
    { key: 'bottom', style: { left: '1.5%', bottom: '2%', width: '72%', height: '15%' }, label: 'handle · caption' },
  ];
  if (mode === 'ad') boxes.push({ key: 'cta', style: { left: '3%', right: '3%', bottom: '9%', height: '15%' }, label: 'CTA box' });
  return boxes;
}

export default function ClientEditPage() {
  const { id: clientId } = useParams();
  const toast = useToast();
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const pollRef = useRef(null);
  const [client, setClient] = useState(null);
  const [mode, setMode] = useState('video');       // 'video' | 'stills' (Stills → Reel)

  const [clips, setClips] = useState([]);          // [{ id, file|null, url, name, duration, remote }]
  const [reopenJobId, setReopenJobId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewH, setPreviewH] = useState(0);

  const [doTrim, setDoTrim] = useState(false);
  const [segments, setSegments] = useState([]);   // [{ id, start, end }] — keep-ranges, joined in order
  const [cleanAudio, setCleanAudio] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [capSize, setCapSize] = useState('medium');
  const [capPos, setCapPos] = useState(0);
  const [aspect, setAspect] = useState('original');
  const [safeZone, setSafeZone] = useState('off');

  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);

  const single = clips.length === 1;
  const combining = clips.length > 1;
  const frameAR = aspect !== 'original' ? AR_DIMS[aspect] : null;
  const duration = single ? clips[0].duration : null;
  const totalDuration = clips.reduce((s, c) => s + (c.duration || 0), 0);

  useEffect(() => {
    api.get(`/clients/${clientId}`).then(setClient).catch(() => {});
    loadJobs();
    return () => { clearInterval(pollRef.current); clips.forEach(c => !c.remote && URL.revokeObjectURL(c.url)); };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  function measurePreview() { const el = frameRef.current || videoRef.current; if (el) setPreviewH(el.clientHeight); }
  useEffect(() => {
    window.addEventListener('resize', measurePreview);
    return () => window.removeEventListener('resize', measurePreview);
  }, []);
  // Re-measure when the frame's aspect changes.
  useEffect(() => { measurePreview(); }, [aspect, clips.length]); // eslint-disable-line
  function seek(t) { if (videoRef.current && isFinite(t)) videoRef.current.currentTime = Math.max(0, t); }

  // Keep captions out of the platform safe zones (clamped when a zone is shown):
  // above the bottom UI (handle/caption for Reel, the bigger CTA box for Ad),
  // and below the top bar. Horizontal clearance of the side rail is handled by
  // narrowing the caption box.
  const capMin = safeZone === 'ad' ? 0.20 : safeZone === 'reel' ? 0.10 : 0;
  const capMax = 0.82;
  useEffect(() => { setCapPos(p => Math.min(capMax, Math.max(capMin, p))); }, [safeZone]); // eslint-disable-line

  function loadJobs() {
    api.get(`/edit/clients/${clientId}/edit`)
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setJobs(list);
        const running = list.some(j => j.status === 'queued' || j.status === 'processing');
        if (running && !pollRef.current) startPoll();
        if (!running && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      })
      .catch(() => {});
  }
  function startPoll() {
    pollRef.current = setInterval(() => {
      api.get(`/edit/clients/${clientId}/edit`).then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setJobs(list);
        if (!list.some(j => j.status === 'queued' || j.status === 'processing')) { clearInterval(pollRef.current); pollRef.current = null; }
      }).catch(() => {});
    }, 3000);
  }

  // Add local clips (append). Any add cancels a reopen (now it's a fresh upload set).
  function addFiles(fileList) {
    const vids = Array.from(fileList || []).filter(f => f.type.startsWith('video/'));
    if (!vids.length) { if ((fileList || []).length) toast('Please choose video files.', 'error'); return; }
    if (reopenJobId) { clearClips(); setReopenJobId(null); }
    const next = vids.map(f => {
      const url = URL.createObjectURL(f);
      const clip = { id: ++_uid, file: f, url, name: f.name, duration: null, remote: false };
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => setClips(prev => prev.map(x => x.id === clip.id ? { ...x, duration: v.duration } : x));
      v.src = url;
      return clip;
    });
    setClips(prev => {
      const merged = [...prev, ...next].slice(0, 20);
      if (prev.length === 0 && merged.length === 1) setSegments([]);   // re-seeded when duration loads
      return merged;
    });
  }
  function clearClips() { setClips(prev => { prev.forEach(c => !c.remote && URL.revokeObjectURL(c.url)); return []; }); }
  function removeClip(id) { setClips(prev => { const c = prev.find(x => x.id === id); if (c && !c.remote) URL.revokeObjectURL(c.url); return prev.filter(x => x.id !== id); }); }
  function move(id, dir) {
    setClips(prev => {
      const i = prev.findIndex(x => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const n = [...prev];[n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }

  // When the single clip's duration lands, seed one keep-range spanning the clip.
  useEffect(() => { if (single && clips[0].duration && segments.length === 0) setSegments([{ id: ++_uid, start: 0, end: clips[0].duration }]); }, [clips]); // eslint-disable-line

  function updateSeg(id, patch) { setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s)); }
  function addSeg() { setSegments(prev => { const last = prev[prev.length - 1]; const start = Math.min(duration - 0.1, last ? last.end : 0); return [...prev, { id: ++_uid, start: Math.max(0, start), end: duration }]; }); }
  function removeSeg(id) { setSegments(prev => prev.length > 1 ? prev.filter(s => s.id !== id) : prev); }

  const validSegs = segments.filter(s => s.end > s.start);
  const effectiveTrim = single && doTrim && validSegs.length > 0 &&
    (validSegs.length > 1 || validSegs[0].start > 0 || (duration && validSegs[0].end < duration - 0.01));
  const keptDuration = effectiveTrim ? validSegs.reduce((s, x) => s + (x.end - x.start), 0) : totalDuration;
  const capCost = captions && keptDuration ? (keptDuration / 60) * WHISPER_PER_MIN : 0;
  const nothingChosen = !(combining || aspect !== 'original' || effectiveTrim || cleanAudio || captions);

  function opsPayload() {
    return {
      aspect,
      segments: effectiveTrim ? validSegs.map(s => ({ start: Math.max(0, s.start), end: s.end })) : null,
      clean_audio: cleanAudio,
      captions,
      caption_style: { size: capSize, pos: capPos },
    };
  }

  async function submit(draft = false) {
    if (!clips.length) { toast('Add a clip first.', 'error'); return; }
    if (!draft && nothingChosen) { toast('Pick at least one edit.', 'error'); return; }
    const localClips = clips.filter(c => c.file);
    if (draft && !localClips.length) { toast('This is already saved — render or delete it.', 'error'); return; }
    setBusy(true);
    try {
      if (!draft && reopenJobId && clips.every(c => c.remote)) {
        await api.post(`/edit/clients/${clientId}/edit/${reopenJobId}/reopen`, { ops: opsPayload() });
      } else {
        const fd = new FormData();
        clips.forEach(c => c.file && fd.append('files', c.file));
        fd.append('ops', JSON.stringify(opsPayload()));
        if (draft) fd.append('draft', 'true');
        if (single && duration) fd.append('duration', String(duration));
        await api.postForm(`/edit/clients/${clientId}/edit`, fd);
      }
      toast(draft ? 'Saved as draft.' : combining ? 'Combining & rendering…' : 'Edit queued — rendering…', 'success');
      clearClips(); setReopenJobId(null); setDoTrim(false); setSegments([]);
      loadJobs(); if (!draft && !pollRef.current) startPoll();
    } catch (err) {
      toast(err.message || 'Could not save the edit.', 'error');
    } finally { setBusy(false); }
  }
  async function renderDraft(jobId) {
    try { await api.post(`/edit/clients/${clientId}/edit/${jobId}/render`); loadJobs(); if (!pollRef.current) startPoll(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function retry(jobId) {
    try { await api.post(`/edit/clients/${clientId}/edit/${jobId}/retry`); loadJobs(); if (!pollRef.current) startPoll(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function remove(jobId) {
    try { await api.delete(`/edit/clients/${clientId}/edit/${jobId}`); setJobs(prev => prev.filter(j => j.id !== jobId)); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function renameJob(job) {
    const name = window.prompt('Name this edit', job.name || job.source_name || '');
    if (name == null) return;
    try { const updated = await api.patch(`/edit/clients/${clientId}/edit/${job.id}`, { name }); setJobs(prev => prev.map(j => j.id === job.id ? updated : j)); }
    catch (err) { toast(err.message, 'error'); }
  }
  // Load a saved edit's source back into the editor to tweak (no re-upload).
  function editAgain(job) {
    clearClips();
    const src = (job.clips && job.clips.length) ? job.clips : [{ url: job.source_url, name: job.source_name }];
    setClips(src.map(c => ({ id: ++_uid, file: null, url: c.url, name: c.name || 'clip', duration: null, remote: true })));
    setReopenJobId(job.id);
    const o = job.ops || {};
    const segs = Array.isArray(o.segments) ? o.segments : (o.trim ? [o.trim] : []);
    setDoTrim(segs.length > 0);
    setSegments(segs.map(s => ({ id: ++_uid, start: s.start || 0, end: s.end || 0 })));
    setCleanAudio(o.clean_audio !== false); setCaptions(!!o.captions);
    setCapSize(o.caption_style?.size || 'medium'); setCapPos(o.caption_style?.pos || 0);
    setAspect(o.aspect || 'original');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function opsSummary(ops = {}, clipCount = 1) {
    if (ops.stills_reel) {
      const s = ops.stills_reel;
      return `stills reel · ${clipCount} clip${clipCount === 1 ? '' : 's'} · ${s.aspect || '9:16'}`;
    }
    const bits = [];
    if (clipCount > 1) bits.push(`combined ${clipCount} clips`);
    if (Array.isArray(ops.segments) && ops.segments.length) bits.push(ops.segments.length > 1 ? `${ops.segments.length} cuts` : `trim ${fmt(ops.segments[0].start)}–${fmt(ops.segments[0].end)}`);
    else if (ops.trim && (ops.trim.start > 0 || ops.trim.end > 0)) bits.push(`trim ${fmt(ops.trim.start)}–${fmt(ops.trim.end)}`);
    if (ops.clean_audio) bits.push('clean audio');
    if (ops.captions) bits.push('captions');
    return bits.join(' · ') || 'edit';
  }

  const STATUS = {
    draft: { label: 'Draft', cls: 'chip-neutral' },
    queued: { label: 'Queued', cls: 'chip-neutral' },
    processing: { label: 'Rendering…', cls: 'chip-info' },
    done: { label: 'Ready', cls: 'chip-success' },
    failed: { label: 'Failed', cls: 'chip-warning' },
  };

  return (
    <div className="stack stack-lg">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Edit</span></div>
      <header className="hero"><div><h1 className="display mt-2">Edit</h1></div></header>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 660, marginTop: -8 }}>
        {mode === 'video'
          ? 'Trim a clip, clean up the audio, add auto-captions — or drop in several clips to combine them into one video. Rendered on our own servers; nothing uploaded to a third party.'
          : 'Turn a set of still images into a moving reel — each still is animated into a short cinematic clip, then stitched together into one vertical video.'}
      </p>

      {/* Mode switch */}
      <div style={{ display: 'inline-flex', gap: 6 }}>
        <button className={`btn btn-sm ${mode === 'video' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('video')}>Video edit</button>
        <button className={`btn btn-sm ${mode === 'stills' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('stills')}>Stills → Reel</button>
      </div>

      {mode === 'stills' && (
        <StillsReelPanel clientId={clientId} onSubmitted={() => { loadJobs(); if (!pollRef.current) startPoll(); }} />
      )}

      <input ref={fileRef} type="file" accept="video/*" multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />

      {/* Empty state */}
      {mode === 'video' && clips.length === 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`, borderRadius: 'var(--r-md)', padding: 64, textAlign: 'center', cursor: 'pointer', background: 'var(--surface)' }}
        >
          <div style={{ fontWeight: 700, fontSize: 16 }}>Drop a video here, or click to choose</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>MP4 or MOV · up to 2GB · add several to combine</div>
        </div>
      )}

      {/* Editor */}
      {mode === 'video' && clips.length > 0 && (
        <div className="edit-split"
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>

          {/* LEFT */}
          <div>
            {single ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', background: '#000', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  <div ref={frameRef} style={frameAR
                    ? { position: 'relative', aspectRatio: `${frameAR[0]} / ${frameAR[1]}`, height: '62vh', maxWidth: '100%', background: '#000' }
                    : { position: 'relative', lineHeight: 0, maxWidth: '100%' }}>
                    <video ref={videoRef} src={clips[0].url} controls
                      onLoadedMetadata={e => { measurePreview(); if (clips[0].remote && !clips[0].duration) { const d = e.target.duration; setClips(prev => prev.map((x, i) => i === 0 ? { ...x, duration: d } : x)); if (segments.length === 0) setSegments([{ id: ++_uid, start: 0, end: d }]); } }}
                      style={frameAR
                        ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }
                        : { maxHeight: '62vh', maxWidth: '100%', display: 'block' }} />
                    {safeZone !== 'off' && previewH > 0 && safeBoxes(safeZone).map(b => (
                      <div key={b.key} style={{ position: 'absolute', ...b.style, background: 'rgba(255,70,70,0.16)', border: '1px dashed rgba(255,70,70,0.8)', borderRadius: 3, pointerEvents: 'none', boxSizing: 'border-box' }}>
                        <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px #000', textTransform: 'uppercase', letterSpacing: 0.3 }}>{b.label}</span>
                      </div>
                    ))}
                    {captions && previewH > 0 && (() => {
                      const fontPx = Math.max(9, previewH * (ASS_SIZE[capSize] || 24) / 288);
                      const marginPx = previewH * marginVFor(capPos) / 288;
                      return (
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: marginPx, textAlign: 'center', pointerEvents: 'none', padding: '0 16%' }}>
                          <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: fontPx, lineHeight: 1.15, color: '#fff', WebkitTextStrokeColor: '#000', WebkitTextStrokeWidth: Math.max(1, fontPx * 0.07), paintOrder: 'stroke', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>the quick brown fox</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="card" style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input type="checkbox" checked={doTrim} onChange={e => setDoTrim(e.target.checked)} /> Trim / cut
                    <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>— keep one or more sections; they join in order</span>
                  </label>
                  {doTrim && duration > 0 && segments.map((s, i) => (
                    <div key={s.id} style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700 }}>Cut {i + 1}</span>
                        {segments.length > 1 && <button onClick={() => removeSeg(s.id)} style={{ border: 'none', background: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 11, padding: 0 }}>remove</button>}
                      </div>
                      <div className="trim-slider">
                        <div style={{ position: 'absolute', top: 14, left: 0, right: 0, height: 4, borderRadius: 2, background: 'var(--card-border)' }} />
                        <div style={{ position: 'absolute', top: 14, height: 4, borderRadius: 2, background: 'var(--text)', left: `${(s.start / duration) * 100}%`, right: `${100 - (s.end / duration) * 100}%` }} />
                        <input type="range" min="0" max={duration} step="0.05" value={s.start} onChange={e => { const v = Math.min(Number(e.target.value), s.end - 0.1); updateSeg(s.id, { start: Math.max(0, v) }); seek(v); }} />
                        <input type="range" min="0" max={duration} step="0.05" value={s.end} onChange={e => { const v = Math.max(Number(e.target.value), s.start + 0.1); updateSeg(s.id, { end: Math.min(duration, v) }); seek(v); }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        <span>Start {fmt(s.start)}</span>
                        <span style={{ color: 'var(--text-subtle)' }}>keeps {fmt(Math.max(0, s.end - s.start))}</span>
                        <span>End {fmt(s.end)}</span>
                      </div>
                    </div>
                  ))}
                  {doTrim && duration > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={addSeg}>+ Add cut</button>
                      {segments.length > 1 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Final length ~{fmt(keptDuration)}</span>}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="card">
                <div className="caption mb-3">Clips — stitched in this order</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {clips.map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 8 }}>
                      <span style={{ fontWeight: 800, color: 'var(--text-subtle)', width: 18, textAlign: 'center' }}>{i + 1}</span>
                      <video src={c.url} muted style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.duration ? fmt(c.duration) : '…'}</div>
                      </div>
                      <button className="btn btn-secondary btn-sm" disabled={i === 0} onClick={() => move(c.id, -1)} title="Move up">↑</button>
                      <button className="btn btn-secondary btn-sm" disabled={i === clips.length - 1} onClick={() => move(c.id, 1)} title="Move down">↓</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => removeClip(c.id)} style={{ color: 'var(--negative)' }} title="Remove">×</button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 10 }}>Combined into one video (matched to clip 1's shape). Trim the result afterwards with “Edit again”.</div>
              </div>
            )}
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => fileRef.current?.click()}>+ Add clip{clips.length ? ' to combine' : ''}</button>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 10, marginLeft: 8 }} onClick={() => { clearClips(); setReopenJobId(null); }}>Clear</button>
          </div>

          {/* RIGHT — settings */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 }}>
            <div className="caption">Edits</div>
            {reopenJobId && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Re-editing a saved clip — renders a new copy.</div>}

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Format</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ASPECTS.map(a => <button key={a.key} onClick={() => setAspect(a.key)} className={'btn btn-sm ' + (aspect === a.key ? 'btn-primary' : 'btn-secondary')}>{a.label}</button>)}
              </div>
              {aspect !== 'original' && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>Reframed to {aspect} — filled to the frame (edges cropped).</div>}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Safe zones (preview)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['off', 'Off'], ['reel', 'Reel'], ['ad', 'Ad']].map(([k, l]) => <button key={k} onClick={() => setSafeZone(k)} className={'btn btn-sm ' + (safeZone === k ? 'btn-primary' : 'btn-secondary')}>{l}</button>)}
              </div>
              {safeZone !== 'off' && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>Red = where Instagram’s UI sits — keep captions/subject clear. Preview only.</div>}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--card-border)', margin: 0 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={cleanAudio} onChange={e => setCleanAudio(e.target.checked)} /> Clean audio
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 24 }}>denoise + level out volume</div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} /> Auto-captions
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 24 }}>burned onto the video + a .srt file</div>
            {captions && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', paddingLeft: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Size</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['small', 'medium', 'large'].map(s => (
                      <button key={s} onClick={() => setCapSize(s)} className={'btn btn-sm ' + (capSize === s ? 'btn-primary' : 'btn-secondary')} style={{ textTransform: 'capitalize' }}>{s}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Position</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 10, color: 'var(--text-subtle)' }}>
                    <span>top</span>
                    <input type="range" min={capMin} max={capMax} step="0.02" value={capPos}
                      onChange={e => setCapPos(Math.min(capMax, Math.max(capMin, Number(e.target.value))))}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', WebkitAppearance: 'slider-vertical', width: 24, height: 104, margin: '4px 0' }} />
                    <span>bottom</span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || nothingChosen} onClick={() => submit(false)}>
                {busy ? 'Starting…' : combining ? `Combine ${clips.length} & render` : 'Render edit'}
              </button>
              {clips.some(c => c.file) && (
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={() => submit(true)}>Save as draft</button>
              )}
              {capCost > 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>Est. ~${capCost.toFixed(2)} (captions)</div>}
            </div>
          </div>
        </div>
      )}

      {/* Jobs / history */}
      {jobs.length > 0 && (
        <div>
          <div className="caption mb-3">Your edits</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {jobs.map(j => {
              const st = STATUS[j.status] || STATUS.queued;
              const clipCount = (j.clips && j.clips.length) || 1;
              const stem = (j.name || j.source_name || 'edit').replace(/\.[^.]+$/, '');
              return (
                <div key={j.id} className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ width: 200, flexShrink: 0 }}>
                    {j.status === 'done' && j.output_url
                      ? <video src={j.output_url} controls style={{ width: '100%', borderRadius: 'var(--r-sm)', background: '#000' }} />
                      : <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 'var(--r-sm)', background: '#00000010', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {(j.status === 'processing' || j.status === 'queued') && <div className="spinner" />}
                        </div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name || j.source_name || 'clip'}</span>
                      <span className={'chip ' + st.cls} style={{ fontSize: 10 }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '3px 0 8px' }}>{opsSummary(j.ops, clipCount)} · {new Date(j.created_at).toLocaleString()}</div>
                    {j.status === 'failed' && j.error && <div className="callout callout-warning" style={{ fontSize: 13, marginBottom: 8 }}>{j.error}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {j.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => renderDraft(j.id)}>Render</button>}
                      {j.status === 'draft' && <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Resume</button>}
                      {j.status === 'done' && j.output_url && <a className="btn btn-primary btn-sm" href={j.output_url} download={`${stem}-edited.mp4`}>Download MP4</a>}
                      {j.status === 'done' && j.srt_url && <a className="btn btn-secondary btn-sm" href={j.srt_url} download={`${stem}.srt`}>Download .srt</a>}
                      {(j.status === 'done' || j.status === 'failed') && !j.ops?.stills_reel && <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Edit again</button>}
                      {j.status === 'failed' && <button className="btn btn-secondary btn-sm" onClick={() => retry(j.id)}>Retry</button>}
                      <button className="btn btn-secondary btn-sm" onClick={() => renameJob(j)}>Rename</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => remove(j.id)} style={{ color: 'var(--negative)' }}>Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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

export default function ClientEditPage() {
  const { id: clientId } = useParams();
  const toast = useToast();
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const pollRef = useRef(null);
  const [client, setClient] = useState(null);

  const [clips, setClips] = useState([]);          // [{ id, file|null, url, name, duration, remote }]
  const [reopenJobId, setReopenJobId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewH, setPreviewH] = useState(0);

  const [doTrim, setDoTrim] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [cleanAudio, setCleanAudio] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [capSize, setCapSize] = useState('medium');

  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);

  const single = clips.length === 1;
  const combining = clips.length > 1;
  const duration = single ? clips[0].duration : null;
  const totalDuration = clips.reduce((s, c) => s + (c.duration || 0), 0);

  useEffect(() => {
    api.get(`/clients/${clientId}`).then(setClient).catch(() => {});
    loadJobs();
    return () => { clearInterval(pollRef.current); clips.forEach(c => !c.remote && URL.revokeObjectURL(c.url)); };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function measure() { if (videoRef.current) setPreviewH(videoRef.current.clientHeight); }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  function seek(t) { if (videoRef.current && isFinite(t)) videoRef.current.currentTime = Math.max(0, t); }

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
      if (prev.length === 0 && merged.length === 1) { setTrimStart(0); setTrimEnd(0); }
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

  // When the single clip's duration lands, default the trim range to full.
  useEffect(() => { if (single && clips[0].duration && trimEnd === 0) setTrimEnd(clips[0].duration); }, [clips]); // eslint-disable-line

  const capCost = captions && totalDuration ? (totalDuration / 60) * WHISPER_PER_MIN : 0;
  const effectiveTrim = single && doTrim && (trimStart > 0 || (duration && trimEnd < duration));
  const nothingChosen = !(combining || effectiveTrim || cleanAudio || captions);

  function opsPayload() {
    return {
      trim: effectiveTrim ? { start: Math.max(0, trimStart), end: trimEnd || 0 } : null,
      clean_audio: cleanAudio,
      captions,
      caption_style: { size: capSize },
    };
  }

  async function submit() {
    if (!clips.length) { toast('Add a clip first.', 'error'); return; }
    if (nothingChosen) { toast('Pick at least one edit.', 'error'); return; }
    setBusy(true);
    try {
      if (reopenJobId && clips.every(c => c.remote)) {
        await api.post(`/edit/clients/${clientId}/edit/${reopenJobId}/reopen`, { ops: opsPayload() });
      } else {
        const fd = new FormData();
        clips.forEach(c => c.file && fd.append('files', c.file));
        fd.append('ops', JSON.stringify(opsPayload()));
        if (single && duration) fd.append('duration', String(duration));
        await api.postForm(`/edit/clients/${clientId}/edit`, fd);
      }
      toast(combining ? 'Combining & rendering…' : 'Edit queued — rendering…', 'success');
      clearClips(); setReopenJobId(null); setDoTrim(false); setTrimStart(0); setTrimEnd(0);
      loadJobs(); if (!pollRef.current) startPoll();
    } catch (err) {
      toast(err.message || 'Could not start the edit.', 'error');
    } finally { setBusy(false); }
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
    setDoTrim(!!(o.trim && (o.trim.start > 0 || o.trim.end > 0)));
    setTrimStart(o.trim?.start || 0); setTrimEnd(o.trim?.end || 0);
    setCleanAudio(o.clean_audio !== false); setCaptions(!!o.captions);
    setCapSize(o.caption_style?.size || 'medium');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function opsSummary(ops = {}, clipCount = 1) {
    const bits = [];
    if (clipCount > 1) bits.push(`combined ${clipCount} clips`);
    if (ops.trim && (ops.trim.start > 0 || ops.trim.end > 0)) bits.push(`trim ${fmt(ops.trim.start)}–${fmt(ops.trim.end)}`);
    if (ops.clean_audio) bits.push('clean audio');
    if (ops.captions) bits.push('captions');
    return bits.join(' · ') || 'edit';
  }

  const STATUS = {
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
        Trim a clip, clean up the audio, add auto-captions — or drop in several clips to combine them
        into one video. Rendered on our own servers; nothing uploaded to a third party.
      </p>

      <input ref={fileRef} type="file" accept="video/*" multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />

      {/* Empty state */}
      {clips.length === 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`, borderRadius: 'var(--r-md)', padding: 64, textAlign: 'center', cursor: 'pointer', background: 'var(--surface)' }}
        >
          <div style={{ fontWeight: 700, fontSize: 16 }}>Drop a video here, or click to choose</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>MP4 or MOV · up to 500MB · add several to combine</div>
        </div>
      )}

      {/* Editor */}
      {clips.length > 0 && (
        <div className="edit-split"
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>

          {/* LEFT */}
          <div>
            {single ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', background: '#000', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  <div style={{ position: 'relative', lineHeight: 0, maxWidth: '100%' }}>
                    <video ref={videoRef} src={clips[0].url} controls
                      onLoadedMetadata={e => { setPreviewH(e.target.clientHeight); if (clips[0].remote && !clips[0].duration) { const d = e.target.duration; setClips(prev => prev.map((x, i) => i === 0 ? { ...x, duration: d } : x)); if (trimEnd === 0) setTrimEnd(d); } }}
                      style={{ maxHeight: '62vh', maxWidth: '100%', display: 'block' }} />
                    {captions && previewH > 0 && (() => {
                      const fontPx = Math.max(9, previewH * (ASS_SIZE[capSize] || 24) / 288);
                      const marginPx = previewH * 48 / 288;
                      return (
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: marginPx, textAlign: 'center', pointerEvents: 'none', padding: '0 5%' }}>
                          <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: fontPx, lineHeight: 1.15, color: '#fff', WebkitTextStrokeColor: '#000', WebkitTextStrokeWidth: Math.max(1, fontPx * 0.07), paintOrder: 'stroke', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>the quick brown fox</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="card" style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input type="checkbox" checked={doTrim} onChange={e => setDoTrim(e.target.checked)} /> Trim
                  </label>
                  {doTrim && duration > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="trim-slider">
                        <div style={{ position: 'absolute', top: 14, left: 0, right: 0, height: 4, borderRadius: 2, background: 'var(--card-border)' }} />
                        <div style={{ position: 'absolute', top: 14, height: 4, borderRadius: 2, background: 'var(--text)', left: `${(trimStart / duration) * 100}%`, right: `${100 - (trimEnd / duration) * 100}%` }} />
                        <input type="range" min="0" max={duration} step="0.05" value={trimStart} onChange={e => { const v = Math.min(Number(e.target.value), trimEnd - 0.1); setTrimStart(Math.max(0, v)); seek(v); }} />
                        <input type="range" min="0" max={duration} step="0.05" value={trimEnd} onChange={e => { const v = Math.max(Number(e.target.value), trimStart + 0.1); setTrimEnd(Math.min(duration, v)); seek(v); }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        <span>Start {fmt(trimStart)}</span>
                        <span style={{ color: 'var(--text-subtle)' }}>keeps {fmt(Math.max(0, (trimEnd || 0) - (trimStart || 0)))}</span>
                        <span>End {fmt(trimEnd)}</span>
                      </div>
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

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={cleanAudio} onChange={e => setCleanAudio(e.target.checked)} /> Clean audio
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 24 }}>denoise + level out volume</div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} /> Auto-captions
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 24 }}>burned onto the video + a .srt file</div>
            {captions && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 24, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Size</span>
                {['small', 'medium', 'large'].map(s => (
                  <button key={s} onClick={() => setCapSize(s)} className={'btn btn-sm ' + (capSize === s ? 'btn-primary' : 'btn-secondary')} style={{ textTransform: 'capitalize' }}>{s}</button>
                ))}
              </div>
            )}

            <div style={{ marginTop: 4 }}>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || nothingChosen} onClick={submit}>
                {busy ? 'Starting…' : combining ? `Combine ${clips.length} & render` : 'Render edit'}
              </button>
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
                      {j.status === 'done' && j.output_url && <a className="btn btn-primary btn-sm" href={j.output_url} download={`${stem}-edited.mp4`}>Download MP4</a>}
                      {j.status === 'done' && j.srt_url && <a className="btn btn-secondary btn-sm" href={j.srt_url} download={`${stem}.srt`}>Download .srt</a>}
                      {(j.status === 'done' || j.status === 'failed') && <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Edit again</button>}
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

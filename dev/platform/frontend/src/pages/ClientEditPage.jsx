import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as EDL from '@shared/edl.mjs';
import Timeline, { stamp } from '../components/video/Timeline';
import EdlPlayer from '../components/video/EdlPlayer';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import StillsReelPanel from '../components/edit/StillsReelPanel';
import ReelChecks from '../components/ReelChecks';
import CaptionTemplates from '../components/CaptionTemplates';

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

export default function ClientEditPage({ embedded = false, clientId: clientIdProp } = {}) {
  const { id: routeClientId } = useParams();
  const clientId = clientIdProp || routeClientId;
  const toast = useToast();
  const fileRef = useRef(null);
  const frameRef = useRef(null);
  const pollRef = useRef(null);
  const [client, setClient] = useState(null);
  const [mode, setMode] = useState('video');       // 'video' | 'stills' (Stills → Reel)

  const [clips, setClips] = useState([]);          // [{ id, file|null, url, name, duration, remote }]
  const [reopenJobId, setReopenJobId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewH, setPreviewH] = useState(0);

  // The edit itself. One EDL replaces `doTrim` + `segments` + the clip order:
  // a trim, a reorder and a multi-cut are the same operation on this object,
  // and it is the only thing sent to the renderer. See shared/edl.mjs.
  const [edl, setEdl] = useState(EDL.emptyEdl());
  const [selectedId, setSelectedId] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  // Positioned text over time, at timeline times. Separate from the EDL
  // because an overlay is not a property of a block: it belongs to the edit's
  // own clock and may span a cut.
  const [overlays, setOverlays] = useState([]);
  const [cleanAudio, setCleanAudio] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [capSize, setCapSize] = useState('medium');
  // Which of the 31 caption templates this render burns, or null for the plain
  // white captions the editor has always had. A template decides its own type,
  // size and placement, so the size and position controls disappear while one
  // is chosen rather than sitting there doing nothing.
  const [capTemplate, setCapTemplate] = useState(null);
  // The template's own name, carried so the column reads "Institution Soft"
  // rather than the id it is stored under.
  const [capTemplateName, setCapTemplateName] = useState(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
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

  function measurePreview() { const el = frameRef.current; if (el) setPreviewH(el.clientHeight); }
  useEffect(() => {
    window.addEventListener('resize', measurePreview);
    return () => window.removeEventListener('resize', measurePreview);
  }, []);
  // Re-measure when the frame's aspect changes.
  useEffect(() => { measurePreview(); }, [aspect, clips.length]); // eslint-disable-line

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
      return merged;   // the EDL effect appends the new clips
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

  // Keep the edit in step with the clip list. Adding a clip appends it whole;
  // removing one drops the blocks that pointed at it. Anything already trimmed
  // is left alone, so adding a fourth clip does not undo three trims.
  useEffect(() => {
    setEdl((prev) => {
      const kept = EDL.normalise(prev, clips);
      const used = new Set(kept.items.map((it) => it.clip));
      let next = kept;
      for (let i = 0; i < clips.length; i++) {
        if (!used.has(i)) next = EDL.append(next, i, clips);
      }
      // A duration arriving late (the browser probing an upload) turns an
      // unknown-length block into a real one, so re-normalise on that too.
      return next;
    });
  }, [clips]);

  const edlRows = useMemo(() => EDL.laidOut(edl), [edl]);
  const keptDuration = useMemo(() => EDL.duration(edl) || totalDuration, [edl, totalDuration]);
  // A real edit is anything the plain stream-copy combine would not produce.
  const effectiveTrim = clips.length > 0 && edl.items.length > 0
    && !EDL.isWholeClipsInOrder(edl, clips);
  // Text on screen is an edit in its own right, even over untouched clips.
  const hasOverlays = overlays.some(o => String(o?.text || '').trim());

  // The player works out which clip the playhead is over and where inside it,
  // and plays straight across a cut. The page only has to say whether there
  // is anything to show.
  const hasPreview = clips.length > 0 && EDL.duration(edl) > 0;
  const capCost = captions && keptDuration ? (keptDuration / 60) * WHISPER_PER_MIN : 0;
  const nothingChosen = !(combining || aspect !== 'original' || effectiveTrim
    || hasOverlays || cleanAudio || captions);

  function opsPayload() {
    return {
      aspect,
      // The edit, as the timeline holds it. `segments` stays null: it was the
      // single-clip-only model this replaces, and sending both would cut the
      // already-cut output a second time.
      edl: effectiveTrim ? { version: EDL.EDL_VERSION, items: edl.items } : null,
      // Sent whenever there is any, independently of the EDL: text over
      // untouched clips is still text on screen.
      overlays: hasOverlays
        ? overlays.filter(o => String(o?.text || '').trim()).map(o => ({
          id: o.id, text: o.text, from: o.from, to: o.to, x: o.x, y: o.y, size: o.size,
        }))
        : null,
      segments: null,
      clean_audio: cleanAudio,
      captions,
      caption_style: { size: capSize, pos: capPos },
      caption_template: capTemplate,
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
      clearClips(); setReopenJobId(null); setEdl(EDL.emptyEdl()); setSelectedId(null);
      setPlayhead(0); setOverlays([]);
      loadJobs(); if (!draft && !pollRef.current) startPoll();
    } catch (err) {
      toast(err.message || 'Could not save the edit.', 'error');
    } finally { setBusy(false); }
  }
  async function renderDraft(jobId) {
    try { await api.post(`/edit/clients/${clientId}/edit/${jobId}/render`); loadJobs(); if (!pollRef.current) startPoll(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function cancelJob(jobId) {
    try {
      const r = await api.post(`/edit/clients/${clientId}/edit/${jobId}/cancel`);
      // "Stopped" and "it had already finished" lead somewhere different, so
      // the toast says which.
      toast(r?.killed ? 'Render stopped.' : 'Taken out of the queue.', 'success');
      loadJobs();
    } catch (err) {
      toast(err.message || 'Could not stop that render.', 'error');
      loadJobs();
    }
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
    // Restore the edit. A job saved by the timeline carries an EDL; an older
    // one carries `ops.segments` or `ops.trim`, which were ranges of a single
    // clip, so they read as blocks over clip 0. Reopening an old job has to
    // bring its cuts back or the operator loses them without being told.
    const legacy = Array.isArray(o.segments) ? o.segments : (o.trim ? [o.trim] : []);
    if (o.edl && Array.isArray(o.edl.items) && o.edl.items.length) {
      setEdl({ version: EDL.EDL_VERSION, items: o.edl.items });
    } else if (legacy.length) {
      setEdl({
        version: EDL.EDL_VERSION,
        items: legacy.map((x, i) => ({
          id: `legacy${i}`, clip: 0,
          in: Math.max(0, Number(x.start) || 0),
          out: Number(x.end) > 0 ? Number(x.end) : null,
          gain: 1,
        })),
      });
    } else {
      setEdl(EDL.emptyEdl());
    }
    setSelectedId(null); setPlayhead(0);
    setOverlays(Array.isArray(o.overlays) ? o.overlays : []);
    setCleanAudio(o.clean_audio !== false); setCaptions(!!o.captions);
    setCapSize(o.caption_style?.size || 'medium'); setCapPos(o.caption_style?.pos || 0);
    setCapTemplate(o.caption_template || null); setCapTemplateName(null);
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
    cancelled: { label: 'Stopped', cls: 'chip-neutral' },
  };

  return (
    <div className="stack stack-lg">
      {!embedded && (<>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Edit</span></div>
      <header className="hero"><div><h1 className="display mt-2">Edit</h1></div></header>
      </>)}
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body)', maxWidth: 660, marginTop: -8 }}>
        {mode === 'video'
          ? 'Trim a clip, clean up the audio, add auto-captions — or drop in several clips to combine them into one video. Rendered on our own servers; nothing uploaded to a third party.'
          : 'Turn a set of still images into a moving reel — each still is animated into a short cinematic clip, then stitched together into one vertical video.'}
      </p>

      {/* Mode switch */}
      <div style={{ display: 'inline-flex', gap: 'var(--s2)' }}>
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
          style={{ border: `2px dashed ${dragOver ? 'var(--text)' : 'var(--card-border)'}`, borderRadius: 'var(--r-md)', padding: 'var(--s10)', textAlign: 'center', cursor: 'pointer', background: 'var(--surface)' }}
        >
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-title)' }}>Drop a video here, or click to choose</div>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-subtle)', marginTop: 'var(--s2)' }}>MP4 or MOV · up to 2GB · add several to combine</div>
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
            {hasPreview ? (
              <>
                <EdlPlayer
                  clips={clips}
                  edl={edl}
                  playhead={playhead}
                  onSeek={setPlayhead}
                  frameAR={frameAR}
                  frameRef={frameRef}
                  onMeta={({ clip, duration, height }) => {
                    if (height) setPreviewH(height);
                    // A clip uploaded earlier has no length until something
                    // loads it, and the timeline cannot lay out a block whose
                    // length is unknown.
                    if (duration) {
                      setClips(prev => prev.map((x, i) => (i === clip && !x.duration ? { ...x, duration } : x)));
                    }
                  }}
                >
                  {safeZone !== 'off' && previewH > 0 && safeBoxes(safeZone).map(b => (
                    <div key={b.key} style={{ position: 'absolute', ...b.style, background: 'rgba(255,70,70,0.16)', border: '1px dashed rgba(255,70,70,0.8)', borderRadius: 'var(--r-sm)', pointerEvents: 'none', boxSizing: 'border-box' }}>
                      <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff', textShadow: '0 1px 2px #000', textTransform: 'uppercase', letterSpacing: 0.3 }}>{b.label}</span>
                    </div>
                  ))}
                  {captions && !capTemplate && previewH > 0 && (() => {
                    const fontPx = Math.max(9, previewH * (ASS_SIZE[capSize] || 24) / 288);
                    const marginPx = previewH * marginVFor(capPos) / 288;
                    return (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: marginPx, textAlign: 'center', pointerEvents: 'none', padding: '0 16%' }}>
                        <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: fontPx, lineHeight: 1.15, color: '#fff', WebkitTextStrokeColor: '#000', WebkitTextStrokeWidth: Math.max(1, fontPx * 0.07), paintOrder: 'stroke', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>the quick brown fox</span>
                      </div>
                    );
                  })()}
                </EdlPlayer>
                <div className="card" style={{ marginTop: 'var(--s3)' }}>
                  <Timeline
                    clips={clips}
                    edl={edl}
                    onChange={setEdl}
                    playhead={playhead}
                    onSeek={setPlayhead}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    overlays={overlays}
                    onOverlaysChange={setOverlays}
                  />
                </div>
              </>
            ) : null}

            <div className="card" style={{ marginTop: 'var(--s3)' }}>
              <div className="caption mb-3">Sources</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                {clips.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s2)' }}>
                    <span style={{ fontWeight: 800, color: 'var(--text-subtle)', width: 18, textAlign: 'center' }}>{i + 1}</span>
                    <video src={c.url} muted style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--r-sm)', background: '#000', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                        {c.duration ? fmt(c.duration) : '…'}
                        {(() => {
                          const n = edl.items.filter(it => it.clip === i).length;
                          return n === 0 ? ' · not on the timeline'
                            : n > 1 ? ` · ${n} blocks` : '';
                        })()}
                      </div>
                    </div>
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => { setEdl(prev => EDL.append(prev, i, clips)); }}
                      title="Add another block from this clip to the end of the timeline">+ Block</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => removeClip(c.id)} style={{ color: 'var(--negative)' }} title="Remove this source and its blocks">×</button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s3)' }}>
                Blocks are cut and joined in timeline order, each matched to the first
                clip&rsquo;s shape. Reordering happens on the timeline, not here.
              </div>
            </div>

            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)' }} onClick={() => fileRef.current?.click()}>+ Add clip{clips.length ? ' to combine' : ''}</button>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)', marginLeft: 'var(--s2)' }} onClick={() => { clearClips(); setReopenJobId(null); }}>Clear</button>
          </div>

          {/* RIGHT — settings */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', position: 'sticky', top: 16 }}>
            <div className="caption">Edits</div>
            {reopenJobId && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>Re-editing a saved clip — renders a new copy.</div>}

            <div>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--s2)' }}>Format</div>
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                {ASPECTS.map(a => <button key={a.key} onClick={() => setAspect(a.key)} className={'btn btn-sm ' + (aspect === a.key ? 'btn-primary' : 'btn-secondary')}>{a.label}</button>)}
              </div>
              {aspect !== 'original' && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>Reframed to {aspect} — filled to the frame (edges cropped).</div>}
            </div>

            <div>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--s2)' }}>Safe zones (preview)</div>
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                {[['off', 'Off'], ['reel', 'Reel'], ['ad', 'Ad']].map(([k, l]) => <button key={k} onClick={() => setSafeZone(k)} className={'btn btn-sm ' + (safeZone === k ? 'btn-primary' : 'btn-secondary')}>{l}</button>)}
              </div>
              {safeZone !== 'off' && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>Red = where Instagram’s UI sits — keep captions/subject clear. Preview only.</div>}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--card-border)', margin: 0 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)' }}>
              <input type="checkbox" checked={cleanAudio} onChange={e => setCleanAudio(e.target.checked)} /> Clean audio
            </label>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 'var(--s6)' }}>denoise + level out volume</div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)' }}>
              <input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} /> Auto-captions
            </label>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: -8, paddingLeft: 'var(--s6)' }}>burned onto the video + a .srt file</div>

            {/* The template library, the same 31 presets Shared renders with and
                compiled by the same compiler, so a template cannot mean one
                thing here and another there. The grid needs room, so the
                column carries the choice and the picker opens full width
                under the editor. */}
            {captions && (
              <div style={{ paddingLeft: 'var(--s6)' }}>
                <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>Style</span>
                  <strong style={{ fontSize: 'var(--fs-body)' }}>
                    {/* A reopened draft knows the id but not the name until the
                        picker has been opened, so the id is tidied rather than
                        printed raw. */}
                    {capTemplate
                      ? (capTemplateName
                        || capTemplate.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
                      : 'Plain'}
                  </strong>
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setPickingTemplate((v) => !v)}>
                    {pickingTemplate ? 'Close' : capTemplate ? 'Change' : 'Choose a template'}
                  </button>
                  {capTemplate && (
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--text-subtle)' }}
                      onClick={() => { setCapTemplate(null); setCapTemplateName(null); }}>
                      Back to plain
                    </button>
                  )}
                </div>
                {capTemplate && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 4, lineHeight: 1.4 }}>
                    The template sets the type, the size and where it sits, and takes this
                    client&rsquo;s brand colours where they are readable over footage.
                  </div>
                )}
              </div>
            )}

            {captions && !capTemplate && (
              <div style={{ display: 'flex', gap: 'var(--s5)', alignItems: 'flex-start', paddingLeft: 'var(--s6)', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: 'var(--s2)' }}>Size</div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                    {['small', 'medium', 'large'].map(s => (
                      <button key={s} onClick={() => setCapSize(s)} className={'btn btn-sm ' + (capSize === s ? 'btn-primary' : 'btn-secondary')} style={{ textTransform: 'capitalize' }}>{s}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: 'var(--s2)' }}>Position</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                    <span>top</span>
                    <input type="range" min={capMin} max={capMax} step="0.02" value={capPos}
                      onChange={e => setCapPos(Math.min(capMax, Math.max(capMin, Number(e.target.value))))}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', WebkitAppearance: 'slider-vertical', width: 24, height: 104, margin: 'var(--s1) 0' }} />
                    <span>bottom</span>
                  </div>
                </div>
              </div>
            )}

            {/* Does this reel do the seven things that make a reel work, and
                what has each of those been worth on this client's own reels?
                Advisory, never blocking: a checklist that stops you rendering
                gets switched off within a fortnight.

                It sits above the render button because that is where the
                decision is, and it judges what the browser already knows: the
                length after trimming, and whether captions are being burned.
                The four checks that read the words wait for the transcript,
                which does not exist until the render transcribes, and they show
                as unjudged rather than failed until then. */}
            {clips.length > 0 && (
              <div style={{ borderTop: 'var(--border-w) solid var(--card-border)',
                paddingTop: 'var(--s3)' }}>
                <ReelChecks
                  clientId={clientId}
                  timings={[]}
                  edit={{
                    duration_s: keptDuration || null,
                    caption_template: captions ? (capTemplate || 'plain') : null,
                    brand: client?.name || null,
                  }}
                />
              </div>
            )}

            <div style={{ marginTop: 'var(--s1)' }}>
              {/* What the render will produce, before it runs. "It generated the
                  exact same video" was this line missing: nothing on the page
                  said whether the output would differ from the input. */}
              {clips.length > 0 && (
                <div className="body-xs" style={{ marginBottom: 'var(--s2)', lineHeight: 1.5 }}>
                  {nothingChosen ? (
                    <span style={{ color: 'var(--warning)' }}>
                      Nothing is set to change. Trim a block, reorder, reframe, or leave
                      captions on, or the render returns the clip you put in.
                    </span>
                  ) : (
                    <span className="text-muted">
                      Will produce one {aspect === 'original' ? '' : `${aspect} `}video,
                      {' '}{stamp(keptDuration)}, from {edl.items.length}
                      {' '}{edl.items.length === 1 ? 'block' : 'blocks'}
                      {effectiveTrim ? ' as cut on the timeline' : ''}
                      {hasOverlays ? `, with ${overlays.filter(o => String(o?.text || '').trim()).length} text `
                        + `${overlays.filter(o => String(o?.text || '').trim()).length === 1 ? 'overlay' : 'overlays'}` : ''}
                      {captions ? ', with burned captions' : ''}
                      {cleanAudio ? ', audio cleaned' : ''}.
                    </span>
                  )}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || nothingChosen} onClick={() => submit(false)}>
                {busy ? 'Starting…'
                  : effectiveTrim ? `Render edit · ${stamp(keptDuration)}`
                    : combining ? `Combine ${clips.length} · ${stamp(keptDuration)}`
                      : 'Render edit'}
              </button>
              {clips.some(c => c.file) && (
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)' }} disabled={busy} onClick={() => submit(true)}>Save as draft</button>
              )}
              {capCost > 0 && <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginTop: 'var(--s2)', textAlign: 'center' }}>Est. ~${capCost.toFixed(2)} (captions)</div>}
            </div>
          </div>
        </div>
      )}

      {clips.length > 0 && captions && pickingTemplate && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <CaptionTemplates
            clientId={clientId}
            value={capTemplate}
            format={aspect === '1:1' ? 'square' : aspect === '4:5' ? 'square' : 'vertical'}
            onChange={(id, t) => {
              setCapTemplate(id); setCapTemplateName(t?.name || null); setPickingTemplate(false);
            }}
          />
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)',
            marginTop: 'var(--s3)', lineHeight: 1.5 }}>
            Choosing a template replaces the plain captions and their size and position
            controls. It costs no more to render: the transcription is the same call, asked
            for per word rather than per line.
          </div>
        </div>
      )}

      {/* Jobs / history */}
      {jobs.length > 0 && (
        <div>
          <div className="caption mb-3">Your edits</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            {jobs.map(j => {
              const st = STATUS[j.status] || STATUS.queued;
              const clipCount = (j.clips && j.clips.length) || 1;
              const stem = (j.name || j.source_name || 'edit').replace(/\.[^.]+$/, '');
              return (
                <div key={j.id} className="card" style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ width: 200, flexShrink: 0 }}>
                    {j.status === 'done' && j.output_url
                      ? <video src={j.output_url} controls style={{ width: '100%', borderRadius: 'var(--r-sm)', background: '#000' }} />
                      : <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 'var(--r-sm)', background: '#00000010', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--s2)', padding: 'var(--s2)' }}>
                          {/* A spinner cannot tell a render that is most of
                              the way through from one that has hung, which on
                              a timeline render of several minutes is the only
                              question worth answering. The stage is what makes
                              the number checkable: "cutting block 3 of 7" can
                              be read against the timeline, and "41%" cannot. */}
                          {j.status === 'processing' && Number(j.progress) > 0 ? (
                            <>
                              <div style={{
                                width: '100%', height: 6, borderRadius: 'var(--r-pill)',
                                background: 'var(--card-border)', overflow: 'hidden',
                              }}>
                                <div style={{
                                  width: `${Math.max(2, Math.min(100, Number(j.progress)))}%`,
                                  height: '100%', background: 'var(--accent)',
                                  transition: 'width 400ms linear',
                                }} />
                              </div>
                              <div className="body-xs text-subtle" style={{ textAlign: 'center', lineHeight: 1.3 }}>
                                {j.stage || 'Rendering'}
                                <br />
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {Math.round(Number(j.progress))}%
                                </span>
                              </div>
                            </>
                          ) : (j.status === 'processing' || j.status === 'queued') ? (
                            <>
                              <div className="spinner" />
                              <span className="body-xs text-subtle">
                                {j.status === 'queued' ? 'Waiting for a slot' : 'Starting'}
                              </span>
                            </>
                          ) : null}
                        </div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-body)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name || j.source_name || 'clip'}</span>
                      <span className={'chip ' + st.cls} style={{ fontSize: 'var(--fs-caption)' }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', margin: 'var(--s1) 0 var(--s2)' }}>{opsSummary(j.ops, clipCount)} · {new Date(j.created_at).toLocaleString()}</div>
                    {j.status === 'failed' && j.error && <div className="callout callout-warning" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>{j.error}</div>}
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                      {j.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => renderDraft(j.id)}>Render</button>}
                      {j.status === 'draft' && <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Resume</button>}
                      {j.status === 'done' && j.output_url && <a className="btn btn-primary btn-sm" href={j.output_url} download={`${stem}-edited.mp4`}>Download MP4</a>}
                      {j.status === 'done' && j.srt_url && <a className="btn btn-secondary btn-sm" href={j.srt_url} download={`${stem}.srt`}>Download .srt</a>}
                      {(j.status === 'done' || j.status === 'failed') && !j.ops?.stills_reel && <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Edit again</button>}
                      {j.status === 'failed' && <button className="btn btn-secondary btn-sm" onClick={() => retry(j.id)}>Retry</button>}
                      {(j.status === 'processing' || j.status === 'queued') && (
                        <button className="btn btn-secondary btn-sm" style={{ color: 'var(--negative)' }}
                          onClick={() => cancelJob(j.id)}>Stop</button>
                      )}
                      {j.status === 'cancelled' && (
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => retry(j.id)}>Run again</button>
                      )}
                      {j.status === 'cancelled' && !j.ops?.stills_reel && (
                        <button className="btn btn-secondary btn-sm" onClick={() => editAgain(j)}>Edit again</button>
                      )}
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

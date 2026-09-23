import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

// In-OMI screen recorder (internal Loom replacement). Record a screen
// walkthrough with your voice, save it, and share the /watch/:token link.
// Capture is native MediaRecorder — no paid service. See
// docs/omi/loom-replacement-plan.md.

const fmtDur = s => {
  if (s == null) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtSize = b => (b == null ? '' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const fmtDate = d => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

// Pick the best WebM profile the browser can actually record.
function pickMime() {
  const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

export default function RecordingsPage({ embedded = false, clientId = null, onSendToEdit } = {}) {
  const toast = useToast();
  const { readOnly } = useAuth();
  // When scoped to a client, the library shows that client's videos and new
  // recordings are auto-attached to them. Read-only client logins get a
  // view-only library (no recorder, import, delete or attach).
  const canEdit = !readOnly;
  const [list, setList] = useState(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined');
  const [withMic, setWithMic] = useState(true);
  const [withCam, setWithCam] = useState(false);
  // Camera bubble appearance — adjustable before AND during a recording (the
  // draw loop reads camSettingsRef every frame). Defaults match the old
  // behaviour (bottom-left, medium, mirrored circle) so nothing changes for
  // anyone who ignores these controls.
  const [camPos, setCamPos] = useState('bottom-left');
  const [camSize, setCamSize] = useState('md');
  const [camShape, setCamShape] = useState('circle');
  const [camMirror, setCamMirror] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | recording | preview | saving
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [clients, setClients] = useState([]);
  const [editClients, setEditClients] = useState(null); // { recId, set:Set }
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [fileMeta, setFileMeta] = useState({ title: '', date: '', share_id: '', views: '' });
  const [fileUploading, setFileUploading] = useState(false);
  const fileImportRef = useRef(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamsRef = useRef([]);
  const blobRef = useRef(null);
  const durationRef = useRef(0);
  const startedRef = useRef(0);
  const tickRef = useRef(null);
  const livePreviewRef = useRef(null);
  const liveStreamRef = useRef(null);  // the stream to show in the live preview
  const rafRef = useRef(null);        // camera-composite draw loop
  const pausedMsRef = useRef(0);       // total paused time
  const pauseStartRef = useRef(0);
  const pausedRef = useRef(false);
  // Live snapshot of the camera-bubble settings for the draw loop.
  const camSettingsRef = useRef({ pos: 'bottom-left', size: 'md', shape: 'circle', mirror: true });
  useEffect(() => { camSettingsRef.current = { pos: camPos, size: camSize, shape: camShape, mirror: camMirror }; }, [camPos, camSize, camShape, camMirror]);

  const load = () => api.get(clientId ? `/recordings?client_id=${clientId}` : '/recordings').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [clientId]);
  // While any recording is exporting, poll the library until it's ready/failed.
  useEffect(() => {
    if (!Array.isArray(list) || !list.some(r => r.export_status === 'processing')) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  useEffect(() => { if (canEdit) api.get('/clients').then(setClients).catch(() => setClients([])); }, [canEdit]);

  const clientName = id => (clients.find(c => c.id === id)?.name) || 'Client';

  function openClientEditor(r) { setEditClients({ recId: r.id, set: new Set(r.client_ids || []) }); }
  function toggleClientSel(id) {
    setEditClients(ec => { const n = new Set(ec.set); n.has(id) ? n.delete(id) : n.add(id); return { ...ec, set: n }; });
  }
  async function saveClients() {
    if (!editClients) return;
    try {
      await api.put(`/recordings/${editClients.recId}/clients`, { client_ids: [...editClients.set] });
      setEditClients(null);
      load();
      toast('Updated');
    } catch (err) { toast('Update failed: ' + (err?.message || ''), 'error'); }
  }
  useEffect(() => () => stopAllTracks(), []);

  // Attach the live stream once the recording preview <video> is mounted.
  useEffect(() => {
    if (phase === 'recording' && livePreviewRef.current && liveStreamRef.current) {
      livePreviewRef.current.srcObject = liveStreamRef.current;
      livePreviewRef.current.muted = true;
      livePreviewRef.current.play().catch(() => {});
    }
  }, [phase]);

  function stopAllTracks() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
  }

  // Composite the screen + a camera bubble onto a canvas and return its
  // captured video track. Position, size, shape and mirror are read live from
  // camSettingsRef each frame, so the presenter can reposition mid-recording.
  function makeCameraComposite(display, camStream) {
    const settings = display.getVideoTracks()[0].getSettings();
    const w = settings.width || 1280, h = settings.height || 720;
    const screenVideo = document.createElement('video');
    screenVideo.srcObject = display; screenVideo.muted = true; screenVideo.play().catch(() => {});
    const camVideo = document.createElement('video');
    camVideo.srcObject = camStream; camVideo.muted = true; camVideo.play().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const SIZE_FRAC = { sm: 0.16, md: 0.24, lg: 0.34 };

    // Rounded-rect path (used for the "square" bubble shape).
    const roundRect = (x, y, rw, rh, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
    };

    const draw = () => {
      try {
        const cfg = camSettingsRef.current || {};
        const d = Math.round(Math.min(w, h) * (SIZE_FRAC[cfg.size] || SIZE_FRAC.md));
        const pad = Math.round(d * 0.16);
        const pos = cfg.pos || 'bottom-left';
        const [vy, vx] = pos.split('-'); // e.g. "bottom-left"
        const bx = vx === 'left' ? pad : vx === 'right' ? w - d - pad : Math.round((w - d) / 2);
        const by = vy === 'top' ? pad : vy === 'bottom' ? h - d - pad : Math.round((h - d) / 2);

        ctx.drawImage(screenVideo, 0, 0, w, h);

        const sw = camVideo.videoWidth || 640, sh = camVideo.videoHeight || 480;
        const side = Math.min(sw, sh);
        ctx.save();
        // Clip to the chosen shape.
        if (cfg.shape === 'square') roundRect(bx, by, d, d, Math.round(d * 0.22));
        else { ctx.beginPath(); ctx.arc(bx + d / 2, by + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath(); }
        ctx.clip();
        // Mirror (selfie view) by flipping horizontally around the bubble centre.
        if (cfg.mirror !== false) { ctx.translate(bx + d / 2, 0); ctx.scale(-1, 1); ctx.translate(-(bx + d / 2), 0); }
        ctx.drawImage(camVideo, (sw - side) / 2, (sh - side) / 2, side, side, bx, by, d, d);
        ctx.restore();

        // Border ring on top (in un-mirrored space).
        ctx.lineWidth = Math.max(2, d * 0.02); ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        if (cfg.shape === 'square') { roundRect(bx, by, d, d, Math.round(d * 0.22)); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(bx + d / 2, by + d / 2, d / 2, 0, Math.PI * 2); ctx.stroke(); }
      } catch { /* a frame not ready yet */ }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return canvas.captureStream(30).getVideoTracks()[0];
  }

  async function startRecording() {
    const mime = pickMime();
    if (!mime) { toast('This browser can’t record video. Try Chrome or Edge.', 'error'); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamsRef.current.push(display);

      let micStream = null;
      if (withMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(micStream);
        } catch { /* no mic / denied — carry on with screen audio only */ }
      }
      let camStream = null;
      if (withCam) {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
          streamsRef.current.push(camStream);
        } catch { toast('Couldn’t access the camera — recording screen only.', 'error'); }
      }

      // Video track: the composited canvas (screen + camera bubble) when the
      // camera is on, otherwise the raw screen track.
      const videoTrack = (camStream && camStream.getVideoTracks().length)
        ? makeCameraComposite(display, camStream)
        : display.getVideoTracks()[0];
      const tracks = [videoTrack];
      // Prefer the mic audio (most browsers record only the first audio track).
      const audio = (micStream && micStream.getAudioTracks()[0]) || display.getAudioTracks()[0];
      if (audio) tracks.push(audio);
      const stream = new MediaStream(tracks);

      // If the user stops sharing via the browser's own bar, end cleanly.
      display.getVideoTracks()[0].addEventListener('ended', () => { if (recorderRef.current && recorderRef.current.state !== 'inactive') stopRecording(); });

      // Stash the stream; the preview <video> only mounts once phase flips to
      // 'recording', so an effect attaches it then (setting it here finds a
      // null ref and leaves the preview black).
      liveStreamRef.current = stream;

      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        blobRef.current = blob;
        durationRef.current = Math.max(0, (Date.now() - startedRef.current - pausedMsRef.current) / 1000);
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase('preview');
        stopAllTracks();
      };
      recorderRef.current = rec;
      rec.start();
      startedRef.current = Date.now();
      pausedMsRef.current = 0; pauseStartRef.current = 0; pausedRef.current = false; setPaused(false);
      setElapsed(0);
      tickRef.current = setInterval(() => {
        if (!pausedRef.current) setElapsed(Math.floor((Date.now() - startedRef.current - pausedMsRef.current) / 1000));
      }, 500);
      setPhase('recording');
    } catch (err) {
      stopAllTracks();
      if (err && err.name === 'NotAllowedError') return; // user cancelled the picker
      toast('Couldn’t start recording: ' + (err?.message || 'unknown error'), 'error');
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause(); pausedRef.current = true; pauseStartRef.current = Date.now(); setPaused(true);
    } else if (rec.state === 'paused') {
      pausedMsRef.current += Date.now() - pauseStartRef.current;
      rec.resume(); pausedRef.current = false; setPaused(false);
    }
  }

  function stopRecording() {
    // If stopped while paused, close out the final pause segment first.
    if (pausedRef.current && pauseStartRef.current) { pausedMsRef.current += Date.now() - pauseStartRef.current; pausedRef.current = false; }
    try { recorderRef.current && recorderRef.current.state !== 'inactive' && recorderRef.current.stop(); }
    catch { /* already stopped */ }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null); blobRef.current = null; setTitle(''); setPhase('idle');
  }

  async function save() {
    if (!blobRef.current) return;
    setPhase('saving');
    try {
      const created = await api.post('/recordings', { title: title.trim() || 'Untitled recording', mime: 'video/webm', client_id: clientId || undefined });
      const fd = new FormData();
      fd.append('file', blobRef.current, 'recording.webm');
      await api.postForm(created.upload.path, fd);
      await api.post(`/recordings/${created.id}/finalize`, { duration_s: Math.round(durationRef.current) });
      const link = window.location.origin + created.share_path;
      try { await navigator.clipboard.writeText(link); toast('Saved — share link copied to clipboard'); }
      catch { toast('Saved'); }
      discard();
      load();
    } catch (err) {
      toast('Save failed: ' + (err?.message || 'unknown error'), 'error');
      setPhase('preview');
    }
  }

  async function transcribeOne(rec) {
    try { await api.post(`/recordings/${rec.id}/transcribe`); toast('Transcribing… refresh in a moment'); }
    catch (err) { toast('Transcription failed: ' + (err?.message || ''), 'error'); }
  }

  async function sendToEdit(rec) {
    if (!clientId) return;
    try {
      await api.post(`/edit/clients/${clientId}/edit/from-recording`, { recording_id: rec.id });
      toast('Sent to Edit');
      if (onSendToEdit) onSendToEdit();
    } catch (err) { toast('Send to Edit failed: ' + (err?.message || ''), 'error'); }
  }

  async function copyLink(rec) {
    const link = window.location.origin + rec.share_path;
    try { await navigator.clipboard.writeText(link); toast('Share link copied'); }
    catch { toast('Couldn’t copy — link: ' + link, 'error'); }
  }

  // Kick off an MP4/GIF export, then poll (via the effect below) until ready.
  async function exportRec(rec, format) {
    try {
      await api.post(`/recordings/${rec.id}/export`, { format });
      toast(`Preparing ${format.toUpperCase()}… this can take a moment`);
      load();
    } catch (err) { toast('Export failed: ' + (err?.message || ''), 'error'); }
  }

  // Download a rendered export with the auth header, then save it locally.
  async function downloadExport(rec, format) {
    try {
      const res = await api.raw(`/recordings/${rec.id}/download?format=${format}`);
      if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(rec.title || 'recording').replace(/[^\w.\- ]+/g, '').trim() || 'recording'}.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) { toast('Download failed: ' + (err?.message || ''), 'error'); }
  }

  async function remove(rec) {
    if (!window.confirm(`Delete “${rec.title}”? This can’t be undone.`)) return;
    try { await api.delete(`/recordings/${rec.id}`); load(); toast('Deleted'); }
    catch (err) { toast('Delete failed: ' + (err?.message || ''), 'error'); }
  }

  async function runLoomImport() {
    const items = importText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [url, views, date] = line.split(',').map(s => (s || '').trim());
      return { url, views: views || undefined, date: date || undefined };
    }).filter(it => /loom\.com\/(share|embed)\//.test(it.url));
    if (!items.length) { toast('Paste at least one Loom share link', 'error'); return; }
    if (items.length > 20) { toast('Up to 20 links per batch — paste the rest after', 'error'); return; }
    setImporting(true); setImportResults(null);
    try {
      const r = await api.post('/recordings/import-loom', { items, client_id: clientId || undefined });
      const results = r?.results || [];
      setImportResults(results);
      const ok = results.filter(x => x.ok).length;
      toast(`Imported ${ok} of ${items.length}${ok < items.length ? ' — see results' : ''}`);
      load();
    } catch (err) { toast('Import failed: ' + (err?.message || ''), 'error'); }
    finally { setImporting(false); }
  }

  async function uploadImport() {
    const f = fileImportRef.current?.files?.[0];
    if (!f) { toast('Choose a video file first', 'error'); return; }
    setFileUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (fileMeta.title) fd.append('title', fileMeta.title);
      if (fileMeta.date) fd.append('created_at', fileMeta.date);
      if (fileMeta.share_id) fd.append('share_id', fileMeta.share_id);
      if (fileMeta.views) fd.append('imported_views', fileMeta.views);
      if (clientId) fd.append('client_id', clientId);
      await api.postForm('/recordings/import', fd);
      toast('Uploaded');
      setFileMeta({ title: '', date: '', share_id: '', views: '' });
      if (fileImportRef.current) fileImportRef.current.value = '';
      load();
    } catch (err) { toast('Upload failed: ' + (err?.message || ''), 'error'); }
    finally { setFileUploading(false); }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Camera-bubble appearance controls, shown when the camera is on. Rendered
  // both on the idle setup panel and (compact) during recording for live
  // repositioning.
  function camControls() {
    const POSITIONS = [
      ['top-left', '◤'], ['top-center', '▲'], ['top-right', '◥'],
      ['center-left', '◀'], ['center-center', '⬤'], ['center-right', '▶'],
      ['bottom-left', '◣'], ['bottom-center', '▼'], ['bottom-right', '◢'],
    ];
    return (
      <div style={{ marginTop: 'var(--s2)', marginBottom: 'var(--s3)', display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div className="body-sm text-subtle" style={{ marginBottom: 'var(--s1)' }}>Camera position</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 26px)', gap: 'var(--s1)' }}>
            {POSITIONS.map(([p, glyph]) => (
              <button key={p} type="button" title={p.replace('-', ' ')} onClick={() => setCamPos(p)}
                className={`tab ${camPos === p ? 'active' : ''}`}
                style={{ padding: 0, height: 26, display: 'grid', placeItems: 'center' }}>{glyph}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="body-sm text-subtle" style={{ marginBottom: 'var(--s1)' }}>Size</div>
          <div className="row" style={{ gap: 'var(--s1)' }}>
            {[['sm', 'S'], ['md', 'M'], ['lg', 'L']].map(([s, l]) => (
              <button key={s} type="button" onClick={() => setCamSize(s)} className={`tab ${camSize === s ? 'active' : ''}`}>{l}</button>
            ))}
          </div>
          <div className="body-sm text-subtle" style={{ margin: 'var(--s3) 0 var(--s1)' }}>Shape</div>
          <div className="row" style={{ gap: 'var(--s1)' }}>
            {[['circle', 'Circle'], ['square', 'Rounded']].map(([s, l]) => (
              <button key={s} type="button" onClick={() => setCamShape(s)} className={`tab ${camShape === s ? 'active' : ''}`}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="body-sm text-subtle" style={{ marginBottom: 'var(--s1)' }}>Mirror</div>
          <button type="button" onClick={() => setCamMirror(m => !m)} className={`tab ${camMirror ? 'active' : ''}`}>{camMirror ? 'On' : 'Off'}</button>
        </div>
      </div>
    );
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} recording${ids.length === 1 ? '' : 's'}? This can’t be undone.`)) return;
    try {
      const r = await api.post('/recordings/bulk-delete', { ids });
      setSelected(new Set());
      load();
      toast(`Deleted ${r?.deleted ?? ids.length}`);
    } catch (err) { toast('Bulk delete failed: ' + (err?.message || ''), 'error'); }
  }

  return (
    <div>
      {!embedded && (<>
      <div className="kicker"><span className="pip" /><span>Video</span></div>
      <header className="hero"><div><h1 className="display mt-2">Video</h1>
        <p className="body text-subtle" style={{ maxWidth: 560, marginTop: 'var(--s2)' }}>
          Record a screen walkthrough with your voice, get a share link, and see who watched — in-house, no Loom.
        </p></div></header>
      </>)}

      {canEdit && (!supported ? (
        <div className="card" style={{ marginTop: 'var(--s4)', color: 'var(--negative)' }}>
          Screen recording needs a Chromium browser (Chrome or Edge) on desktop. This browser doesn’t support it.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 'var(--s4)' }}>
          {phase === 'idle' && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)', marginBottom: 'var(--s3)' }}>
                <input type="checkbox" checked={withMic} onChange={e => setWithMic(e.target.checked)} />
                Record my microphone (narration)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)', marginBottom: 'var(--s4)' }}>
                <input type="checkbox" checked={withCam} onChange={e => setWithCam(e.target.checked)} />
                Show my camera (a bubble in the corner)
              </label>
              {withCam && camControls()}
              <button onClick={startRecording} className="btn btn-primary">
                ● Start recording
              </button>
              <p className="body-sm text-subtle" style={{ marginTop: 'var(--s3)', margin: 'var(--s3) 0 0' }}>
                You’ll pick which screen, window or tab to share.
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div>
              <div className="row" style={{ alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)', fontWeight: 700, color: paused ? 'var(--text-subtle)' : 'var(--negative)' }}>
                  <span style={{ width: 12, height: 12, borderRadius: paused ? 2 : '50%', background: paused ? 'var(--text-subtle)' : 'var(--negative)', display: 'inline-block', animation: paused ? 'none' : 'pulse 1.2s infinite' }} />
                  {paused ? 'Paused' : 'Recording'} {fmtDur(elapsed)}
                </span>
              </div>
              <video ref={livePreviewRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: 320, background: '#000', borderRadius: 'var(--r-md)' }} />
              {withCam && camControls()}
              <div className="row" style={{ marginTop: 'var(--s3)', gap: 'var(--s3)' }}>
                <button onClick={togglePause} className="btn btn-secondary">
                  {paused ? '▶ Resume' : '❚❚ Pause'}
                </button>
                <button onClick={stopRecording} className="btn btn-primary">
                  ■ Stop
                </button>
              </div>
            </div>
          )}

          {(phase === 'preview' || phase === 'saving') && (
            <div>
              {previewUrl && <video src={previewUrl} controls style={{ width: '100%', maxHeight: 340, background: '#000', borderRadius: 'var(--r-md)' }} />}
              <div style={{ marginTop: 'var(--s3)' }}>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Give it a title…" disabled={phase === 'saving'}
                  className="input" style={{ width: '100%', maxWidth: 420 }} />
              </div>
              <div className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
                <button onClick={save} disabled={phase === 'saving'} className="btn btn-primary">
                  {phase === 'saving' ? 'Saving…' : 'Save & copy link'}
                </button>
                <button onClick={discard} disabled={phase === 'saving'} className="btn btn-secondary">
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <button onClick={() => setImportOpen(o => !o)} className="btn-link">
          {importOpen ? '−' : '+'} Import from Loom
        </button>
        {importOpen && (
          <div style={{ marginTop: 'var(--s3)' }}>
            <p className="body-sm text-subtle" style={{ margin: '0 0 var(--s2)' }}>
              Paste Loom share links, one per line. Optionally add prior view count and original date, comma-separated:
              <br /><code>https://www.loom.com/share/abc123, 42, 2025-03-14</code>
            </p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5} disabled={importing}
              placeholder="https://www.loom.com/share/…&#10;https://www.loom.com/share/…, 128, 2024-11-02"
              className="textarea" style={{ width: '100%', fontFamily: 'monospace' }} />
            <div className="row" style={{ gap: 'var(--s3)', alignItems: 'center', marginTop: 'var(--s3)' }}>
              <button onClick={runLoomImport} disabled={importing} className="btn btn-primary">
                {importing ? 'Importing…' : 'Import'}
              </button>
              <span className="body-sm text-subtle">Up to 20 per batch. Keeps the original Loom link as the share ID.</span>
            </div>
            <p className="body-sm text-subtle" style={{ margin: 'var(--s3) 0 0' }}>
              Best-effort — only works for videos with sharing/downloads enabled. Anything that can’t be pulled will show below; download those from Loom and re-add later.
            </p>
            {importResults && (
              <div style={{ marginTop: 'var(--s3)', display: 'grid', gap: 'var(--s2)' }}>
                {importResults.map((r, i) => (
                  <div key={i} className="body-sm" style={{ color: r.ok ? 'var(--positive)' : 'var(--negative)' }}>
                    {r.ok ? '✓' : '✕'} {r.url}{r.ok ? '' : ` — ${r.error}`}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 'var(--s5)', paddingTop: 'var(--s4)', borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div className="body-sm" style={{ fontWeight: 700, marginBottom: 'var(--s1)' }}>Or upload a file</div>
              <p className="body-sm text-subtle" style={{ margin: '0 0 var(--s3)' }}>
                For anything Loom won’t release: download the MP4 from Loom, then upload it here with its details. This always works.
              </p>
              <input ref={fileImportRef} type="file" accept="video/*" disabled={fileUploading} style={{ fontSize: 'var(--fs-body)' }} />
              <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
                <input value={fileMeta.title} onChange={e => setFileMeta(m => ({ ...m, title: e.target.value }))} placeholder="Title"
                  className="input" style={{ flex: '2 1 200px' }} />
                <input value={fileMeta.date} onChange={e => setFileMeta(m => ({ ...m, date: e.target.value }))} type="date" title="Original date"
                  className="input" style={{ flex: '1 1 130px' }} />
                <input value={fileMeta.share_id} onChange={e => setFileMeta(m => ({ ...m, share_id: e.target.value }))} placeholder="Loom ID (optional)"
                  className="input" style={{ flex: '1 1 150px' }} />
                <input value={fileMeta.views} onChange={e => setFileMeta(m => ({ ...m, views: e.target.value }))} type="number" min="0" placeholder="Prior views"
                  className="input" style={{ flex: '1 1 110px' }} />
              </div>
              <button onClick={uploadImport} disabled={fileUploading} className="btn btn-secondary" style={{ marginTop: 'var(--s3)' }}>
                {fileUploading ? 'Uploading…' : 'Upload video'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: embedded ? 16 : 28, marginBottom: 'var(--s3)', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <h2 className="h5" style={{ margin: 0 }}>{clientId ? 'Videos' : 'My recordings'}</h2>
        {canEdit && selected.size > 0 && (
          <button onClick={bulkDelete} className="btn btn-danger">
            Delete selected ({selected.size})
          </button>
        )}
      </div>
      {list === null ? (
        <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-subtle" style={{ padding: 'var(--s5)' }}>{canEdit ? 'No videos yet.' : 'No videos here yet.'}</div>
      ) : (
        <div className="grid" style={{ gap: 'var(--s3)' }}>
          {list.map(r => {
            const views = (r.view_count || 0) + (r.imported_views || 0);
            return (
            <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', flexWrap: 'wrap', outline: selected.has(r.id) ? '2px solid var(--accent)' : 'none' }}>
              {canEdit && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`Select ${r.title}`} />}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>{r.title}</div>
                <div className="body-sm text-subtle" style={{ marginTop: 'var(--s1)' }}>
                  {fmtDate(r.created_at)} · {fmtDur(r.duration_s)} · {views} view{views === 1 ? '' : 's'}
                  {r.imported_views ? ` (${r.imported_views} from Loom)` : ''}
                  {r.size_bytes ? ' · ' + fmtSize(r.size_bytes) : ''}
                  {r.status !== 'ready' ? ` · ${r.status}` : ''}
                </div>
                {canEdit && (
                <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  {(r.client_ids || []).map(cid => (
                    <span key={cid} style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, padding: 'var(--s1) var(--s2)', borderRadius: 'var(--r-pill)', background: 'var(--accent-tint, rgba(0,0,0,0.06))', border: 'var(--border-w) solid var(--card-border)' }}>{clientName(cid)}</span>
                  ))}
                  <button onClick={() => openClientEditor(r)} className="btn btn-secondary btn-sm">
                    {(r.client_ids || []).length ? 'Edit clients' : '+ Add to client'}
                  </button>
                </div>
                )}
                {canEdit && editClients && editClients.recId === r.id && (
                  <div className="card" style={{ marginTop: 'var(--s2)', padding: 'var(--s3)', maxWidth: 360 }}>
                    <div className="body-sm" style={{ fontWeight: 700, marginBottom: 'var(--s2)' }}>Attach to clients</div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 'var(--s1)' }}>
                      {clients.map(c => (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)' }}>
                          <input type="checkbox" checked={editClients.set.has(c.id)} onChange={() => toggleClientSel(c.id)} />
                          {c.name}
                        </label>
                      ))}
                      {!clients.length && <span className="body-sm text-subtle">No clients found.</span>}
                    </div>
                    <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                      <button onClick={saveClients} className="btn btn-primary btn-sm">Save</button>
                      <button onClick={() => setEditClients(null)} className="btn btn-secondary btn-sm">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 'var(--s2)' }}>
                <a href={r.share_path} target="_blank" rel="noopener noreferrer"
                  style={{ padding: 'var(--s2) var(--s4)', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-body)', fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}>Open</a>
                <button onClick={() => copyLink(r)} className="btn btn-secondary btn-sm">Copy link</button>
                {canEdit && r.status === 'ready' && ['mp4', 'gif'].map(fmt => {
                  const has = fmt === 'gif' ? r.has_gif : r.has_mp4;
                  const label = fmt.toUpperCase();
                  if (has) return (
                    <button key={fmt} onClick={() => downloadExport(r, fmt)} title={`Download ${label}`}
                      className="btn btn-secondary btn-sm">{label}</button>
                  );
                  if (r.export_status === 'processing') return (
                    <button key={fmt} disabled title="Rendering…"
                      className="btn btn-secondary btn-sm">… {label}</button>
                  );
                  return (
                    <button key={fmt} onClick={() => exportRec(r, fmt)} title={`Render a shareable ${label}`}
                      className="btn btn-secondary btn-sm">{label}</button>
                  );
                })}
                {canEdit && clientId && r.status === 'ready' && (
                  <button onClick={() => sendToEdit(r)} title="Trim / caption this in the editor"
                    className="btn btn-secondary btn-sm">Send to Edit</button>
                )}
                {canEdit && !r.has_transcript && (
                  <button onClick={() => transcribeOne(r)} title="Generate a transcript"
                    className="btn btn-secondary btn-sm">Transcribe</button>
                )}
                {canEdit && (
                <button onClick={() => remove(r)} className="btn btn-danger btn-sm">Delete</button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }`}</style>
    </div>
  );
}

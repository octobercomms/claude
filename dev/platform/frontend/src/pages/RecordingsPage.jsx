import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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

export default function RecordingsPage() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined');
  const [withMic, setWithMic] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | recording | preview | saving
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [title, setTitle] = useState('');

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamsRef = useRef([]);
  const blobRef = useRef(null);
  const durationRef = useRef(0);
  const startedRef = useRef(0);
  const tickRef = useRef(null);
  const livePreviewRef = useRef(null);

  const load = () => api.get('/recordings').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  useEffect(() => () => stopAllTracks(), []);

  function stopAllTracks() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
  }

  async function startRecording() {
    const mime = pickMime();
    if (!mime) { toast('This browser can’t record video. Try Chrome or Edge.', 'error'); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamsRef.current.push(display);
      const tracks = [...display.getVideoTracks()];
      // Screen audio (if the user shared a tab with audio) plus their mic, so a
      // narrated walkthrough captures the voice. Most browsers record only the
      // first audio track, so prefer the mic when present.
      let micStream = null;
      if (withMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(micStream);
        } catch { /* no mic / denied — carry on with screen audio only */ }
      }
      const audio = (micStream && micStream.getAudioTracks()[0]) || display.getAudioTracks()[0];
      if (audio) tracks.push(audio);
      const stream = new MediaStream(tracks);

      // If the user stops sharing via the browser's own bar, end cleanly.
      display.getVideoTracks()[0].addEventListener('ended', () => { if (phase === 'recording') stopRecording(); });

      if (livePreviewRef.current) { livePreviewRef.current.srcObject = stream; livePreviewRef.current.muted = true; livePreviewRef.current.play().catch(() => {}); }

      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        blobRef.current = blob;
        durationRef.current = (Date.now() - startedRef.current) / 1000;
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase('preview');
        stopAllTracks();
      };
      recorderRef.current = rec;
      rec.start();
      startedRef.current = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 500);
      setPhase('recording');
    } catch (err) {
      stopAllTracks();
      if (err && err.name === 'NotAllowedError') return; // user cancelled the picker
      toast('Couldn’t start recording: ' + (err?.message || 'unknown error'), 'error');
    }
  }

  function stopRecording() {
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
      const created = await api.post('/recordings', { title: title.trim() || 'Untitled recording', mime: 'video/webm' });
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

  async function copyLink(rec) {
    const link = window.location.origin + rec.share_path;
    try { await navigator.clipboard.writeText(link); toast('Share link copied'); }
    catch { toast('Couldn’t copy — link: ' + link, 'error'); }
  }

  async function remove(rec) {
    if (!window.confirm(`Delete “${rec.title}”? This can’t be undone.`)) return;
    try { await api.delete(`/recordings/${rec.id}`); load(); toast('Deleted'); }
    catch (err) { toast('Delete failed: ' + (err?.message || ''), 'error'); }
  }

  return (
    <div>
      <div className="kicker"><span className="pip" /><span>Record</span></div>
      <header className="hero"><div><h1 className="display mt-2">Recordings</h1>
        <p className="body text-subtle" style={{ maxWidth: 560, marginTop: 8 }}>
          Record a screen walkthrough with your voice, get a share link, and see who watched — in-house, no Loom.
        </p></div></header>

      {!supported ? (
        <div className="card" style={{ marginTop: 16, color: 'var(--negative)' }}>
          Screen recording needs a Chromium browser (Chrome or Edge) on desktop. This browser doesn’t support it.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          {phase === 'idle' && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 14 }}>
                <input type="checkbox" checked={withMic} onChange={e => setWithMic(e.target.checked)} />
                Record my microphone (narration)
              </label>
              <button onClick={startRecording}
                style={{ padding: '11px 24px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--accent)', color: 'var(--accent-on)', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                ● Start recording
              </button>
              <p className="body-sm text-subtle" style={{ marginTop: 10, margin: '10px 0 0' }}>
                You’ll pick which screen, window or tab to share.
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div>
              <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--negative)' }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--negative)', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                  Recording {fmtDur(elapsed)}
                </span>
              </div>
              <video ref={livePreviewRef} style={{ width: '100%', maxHeight: 320, background: '#000', borderRadius: 'var(--r-md)' }} />
              <div style={{ marginTop: 12 }}>
                <button onClick={stopRecording}
                  style={{ padding: '10px 22px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--text)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                  ■ Stop
                </button>
              </div>
            </div>
          )}

          {(phase === 'preview' || phase === 'saving') && (
            <div>
              {previewUrl && <video src={previewUrl} controls style={{ width: '100%', maxHeight: 340, background: '#000', borderRadius: 'var(--r-md)' }} />}
              <div style={{ marginTop: 12 }}>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Give it a title…" disabled={phase === 'saving'}
                  style={{ width: '100%', maxWidth: 420, padding: '9px 12px', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 14, fontFamily: 'inherit' }} />
              </div>
              <div className="row" style={{ gap: 10, marginTop: 12 }}>
                <button onClick={save} disabled={phase === 'saving'}
                  style={{ padding: '10px 22px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--accent)', color: 'var(--accent-on)', fontWeight: 800, fontSize: 15, cursor: phase === 'saving' ? 'default' : 'pointer', opacity: phase === 'saving' ? 0.6 : 1 }}>
                  {phase === 'saving' ? 'Saving…' : 'Save & copy link'}
                </button>
                <button onClick={discard} disabled={phase === 'saving'}
                  style={{ padding: '10px 22px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <h2 className="h5" style={{ marginTop: 28, marginBottom: 12 }}>My recordings</h2>
      {list === null ? (
        <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-subtle" style={{ padding: 20 }}>No recordings yet — hit Start recording above.</div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {list.map(r => (
            <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>{r.title}</div>
                <div className="body-sm text-subtle" style={{ marginTop: 3 }}>
                  {fmtDate(r.created_at)} · {fmtDur(r.duration_s)} · {r.view_count || 0} view{(r.view_count || 0) === 1 ? '' : 's'}
                  {r.size_bytes ? ' · ' + fmtSize(r.size_bytes) : ''}
                  {r.status !== 'ready' ? ` · ${r.status}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <a href={r.share_path} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}>Open</a>
                <button onClick={() => copyLink(r)}
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Copy link</button>
                <button onClick={() => remove(r)}
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', color: 'var(--negative)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }`}</style>
    </div>
  );
}

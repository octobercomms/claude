import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';
import ListDetail from '../components/shells/ListDetail';

// Produce > Audio. Record or upload audio, then clean it with AI (ElevenLabs
// Audio Isolation) to strip echo, background noise and room reverb while
// keeping speech natural. Before/after player, download cleaned file.

function fmtSize(b) {
  if (b == null) return '';
  return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
}
function fmtDate(d) {
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const opts = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || null;
}
const baseMime = (m) => String(m || '').split(';')[0].trim() || 'audio/webm';
const extFor = (m) => {
  const b = baseMime(m);
  if (b === 'audio/mp4') return 'm4a';
  if (b === 'audio/ogg') return 'ogg';
  return 'webm';
};

export default function AudioPage({ clientId = null } = {}) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  // Recorder state
  const [recPhase, setRecPhase] = useState('idle'); // idle | recording | paused | done
  const [elapsed, setElapsed] = useState(0);
  const [supported] = useState(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const previewRef = useRef(null);

  function loadList() {
    api.get(`/audio${clientId ? `?client_id=${clientId}` : ''}`).then(r => setList(r.items || [])).catch(() => {});
  }
  useEffect(() => { loadList(); return () => clearTimeout(pollRef.current); /* eslint-disable-next-line */ }, [clientId]);

  // Poll while processing.
  useEffect(() => {
    clearTimeout(pollRef.current);
    if (current && current.status === 'processing') {
      pollRef.current = setTimeout(() => {
        api.get(`/audio/${current.id}`).then(t => { setCurrent(t); if (t.status !== 'processing') loadList(); }).catch(() => {});
      }, 3000);
    }
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function open(id) {
    api.get(`/audio/${id}`).then(setCurrent).catch(e => toast(e.message, 'error'));
  }

  // ── Upload (file pick or recorded blob) ──────────────────────────────────
  async function uploadBlob(blob, title) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, title);
      fd.append('title', title);
      if (clientId) fd.append('client_id', clientId);
      const t = await api.postForm('/audio', fd);
      setCurrent(t);
      loadList();
      toast('Uploaded. Cleaning audio with AI…', 'success');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'error'); }
    finally { setUploading(false); }
  }

  function onFilePick(e) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    uploadBlob(f, f.name);
  }

  // ── Recorder ─────────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const mime2 = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime2 });
        blobRef.current = blob;
        previewRef.current = URL.createObjectURL(blob);
        setRecPhase('done');
      };
      recorderRef.current = rec;
      rec.start(1000);
      setRecPhase('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (e) {
      toast('Microphone access denied or unavailable.', 'error');
    }
  }

  function pauseRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      clearInterval(timerRef.current);
      setRecPhase('paused');
    }
  }
  function resumeRecording() {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
      setRecPhase('recording');
    }
  }
  function stopRecording() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }
  function discardRecording() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    blobRef.current = null;
    previewRef.current = null;
    setRecPhase('idle');
    setElapsed(0);
  }
  function saveRecording() {
    if (!blobRef.current) return;
    const mime2 = blobRef.current.type || 'audio/webm';
    const ext = extFor(mime2);
    const title = `Recording ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.${ext}`;
    uploadBlob(blobRef.current, title);
    discardRecording();
  }

  const fmtElapsed = (s) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // ── Actions on current ───────────────────────────────────────────────────
  async function retry() {
    try { await api.post(`/audio/${current.id}/retry`, {}); setCurrent({ ...current, status: 'processing', error: null }); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    if (!window.confirm('Delete this audio and its cleaned version? Cannot be undone.')) return;
    try { await api.delete(`/audio/${id}`); if (current?.id === id) setCurrent(null); loadList(); }
    catch (e) { toast(e.message, 'error'); }
  }
  function downloadCleaned() {
    const a = document.createElement('a');
    a.href = `/api/audio/${current.id}/cleaned?dl=1`;
    a.download = '';
    a.click();
  }

  return (
    <ListDetail
      sidebar
      list={(
        <div>
          {/* Record card */}
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <h3 className="h3 mb-2">Audio</h3>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', margin: '0 0 var(--s3)' }}>
              Record or upload audio. We remove echo and background noise with AI, keeping speech natural.
            </p>

            {recPhase === 'idle' && (
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                {supported && (
                  <button className="btn btn-primary" {...roWrite(readOnly, { onClick: startRecording, disabled: uploading })}>
                    Record
                  </button>
                )}
                <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm" style={{ display: 'none' }} onChange={onFilePick} />
                <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: () => fileRef.current?.click(), disabled: uploading })}>
                  {uploading ? 'Uploading…' : 'Upload file'}
                </button>
              </div>
            )}

            {(recPhase === 'recording' || recPhase === 'paused') && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: recPhase === 'recording' ? 'var(--negative)' : 'var(--text-muted)', display: 'inline-block', animation: recPhase === 'recording' ? 'pulse 1s infinite' : 'none' }} />
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtElapsed(elapsed)}</span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{recPhase === 'paused' ? 'Paused' : 'Recording…'}</span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  {recPhase === 'recording'
                    ? <button className="btn btn-secondary btn-sm" onClick={pauseRecording}>Pause</button>
                    : <button className="btn btn-secondary btn-sm" onClick={resumeRecording}>Resume</button>
                  }
                  <button className="btn btn-primary btn-sm" onClick={stopRecording}>Stop</button>
                </div>
              </div>
            )}

            {recPhase === 'done' && (
              <div>
                <audio src={previewRef.current} controls style={{ width: '100%', marginBottom: 'var(--s2)' }} />
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: saveRecording, disabled: uploading })}>
                    {uploading ? 'Uploading…' : 'Clean this audio'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={discardRecording}>Discard</button>
                </div>
              </div>
            )}
          </div>

          {/* List */}
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 var(--s2)' }}>Recent</div>
          {!list.length && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>No audio files yet.</div>}
          {list.map(t => (
            <div key={t.id} onClick={() => open(t.id)}
              style={{ padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', marginBottom: 'var(--s2)', cursor: 'pointer',
                background: current?.id === t.id ? 'var(--surface-raised)' : 'var(--surface)' }}>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                {t.status === 'processing' ? 'Cleaning…' : t.status === 'error' ? 'Failed' : 'Ready'}
                {t.size_bytes ? ` · ${fmtSize(t.size_bytes)}` : ''}
                {t.created_at ? ` · ${fmtDate(t.created_at)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      detail={(
        <div>
          {!current && (
            <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>
              Record or upload audio to get started, or pick one from the list.
            </div>
          )}

          {current && current.status === 'processing' && (
            <div className="card">
              <h3 className="h3 mb-2">{current.title}</h3>
              <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-subtle)' }}>
                Cleaning your audio with AI. Removing echo and background noise while keeping speech natural. This usually takes 30 seconds to a minute.
              </p>
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-raised)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--primary)', width: '60%', animation: 'pulse 2s infinite' }} />
                </div>
              </div>
            </div>
          )}

          {current && current.status === 'error' && (
            <div className="card">
              <h3 className="h3 mb-2">{current.title}</h3>
              <div style={{ padding: 'var(--s3)', background: 'var(--negative-soft)', border: '1px solid #f5c6cb', color: 'var(--negative)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)', marginBottom: 'var(--s3)' }}>
                Audio cleanup failed: {current.error || 'unknown error'}
              </div>
              <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: retry })}>Try again</button>
            </div>
          )}

          {current && current.status === 'ready' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                <h3 className="h3" style={{ margin: 0 }}>{current.title}</h3>
                <button type="button" title="Delete" onClick={() => remove(current.id)}
                  className="btn-link" style={{ color: 'var(--negative)' }}>Delete</button>
              </div>

              <div style={{ marginTop: 'var(--s4)' }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Original</div>
                <audio src={`/api/audio/${current.id}/original`} controls style={{ width: '100%' }} />
                {current.size_bytes && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>{fmtSize(current.size_bytes)}</div>}
              </div>

              <div style={{ marginTop: 'var(--s4)' }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Cleaned</div>
                <audio src={`/api/audio/${current.id}/cleaned`} controls style={{ width: '100%' }} />
                {current.cleaned_size && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>{fmtSize(current.cleaned_size)}</div>}
              </div>

              <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s4)', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={downloadCleaned}>Download cleaned audio</button>
              </div>
            </div>
          )}
        </div>
      )}
    />
  );
}

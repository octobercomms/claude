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
  const [selected, setSelected] = useState(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

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

  async function transcribeOne(rec) {
    try { await api.post(`/recordings/${rec.id}/transcribe`); toast('Transcribing… refresh in a moment'); }
    catch (err) { toast('Transcription failed: ' + (err?.message || ''), 'error'); }
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

  async function runLoomImport() {
    const items = importText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [url, views, date] = line.split(',').map(s => (s || '').trim());
      return { url, views: views || undefined, date: date || undefined };
    }).filter(it => /loom\.com\/(share|embed)\//.test(it.url));
    if (!items.length) { toast('Paste at least one Loom share link', 'error'); return; }
    if (items.length > 20) { toast('Up to 20 links per batch — paste the rest after', 'error'); return; }
    setImporting(true); setImportResults(null);
    try {
      const r = await api.post('/recordings/import-loom', { items });
      const results = r?.results || [];
      setImportResults(results);
      const ok = results.filter(x => x.ok).length;
      toast(`Imported ${ok} of ${items.length}${ok < items.length ? ' — see results' : ''}`);
      load();
    } catch (err) { toast('Import failed: ' + (err?.message || ''), 'error'); }
    finally { setImporting(false); }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
      <div className="kicker"><span className="pip" /><span>Video</span></div>
      <header className="hero"><div><h1 className="display mt-2">Video</h1>
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

      <div className="card" style={{ marginTop: 16 }}>
        <button onClick={() => setImportOpen(o => !o)}
          style={{ background: 'transparent', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: 'var(--text)' }}>
          {importOpen ? '−' : '+'} Import from Loom
        </button>
        {importOpen && (
          <div style={{ marginTop: 12 }}>
            <p className="body-sm text-subtle" style={{ margin: '0 0 8px' }}>
              Paste Loom share links, one per line. Optionally add prior view count and original date, comma-separated:
              <br /><code>https://www.loom.com/share/abc123, 42, 2025-03-14</code>
            </p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5} disabled={importing}
              placeholder="https://www.loom.com/share/…&#10;https://www.loom.com/share/…, 128, 2024-11-02"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }} />
            <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 10 }}>
              <button onClick={runLoomImport} disabled={importing}
                style={{ padding: '9px 20px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--accent)', color: 'var(--accent-on)', fontWeight: 800, fontSize: 14, cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}>
                {importing ? 'Importing…' : 'Import'}
              </button>
              <span className="body-sm text-subtle">Up to 20 per batch. Keeps the original Loom link as the share ID.</span>
            </div>
            <p className="body-sm text-subtle" style={{ margin: '10px 0 0' }}>
              Best-effort — only works for videos with sharing/downloads enabled. Anything that can’t be pulled will show below; download those from Loom and re-add later.
            </p>
            {importResults && (
              <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                {importResults.map((r, i) => (
                  <div key={i} className="body-sm" style={{ color: r.ok ? 'var(--positive)' : 'var(--negative)' }}>
                    {r.ok ? '✓' : '✕'} {r.url}{r.ok ? '' : ` — ${r.error}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 className="h5" style={{ margin: 0 }}>My recordings</h2>
        {selected.size > 0 && (
          <button onClick={bulkDelete}
            style={{ padding: '7px 16px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--negative)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Delete selected ({selected.size})
          </button>
        )}
      </div>
      {list === null ? (
        <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-subtle" style={{ padding: 20 }}>No recordings yet — hit Start recording above.</div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {list.map(r => {
            const views = (r.view_count || 0) + (r.imported_views || 0);
            return (
            <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', outline: selected.has(r.id) ? '2px solid var(--accent)' : 'none' }}>
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`Select ${r.title}`} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>{r.title}</div>
                <div className="body-sm text-subtle" style={{ marginTop: 3 }}>
                  {fmtDate(r.created_at)} · {fmtDur(r.duration_s)} · {views} view{views === 1 ? '' : 's'}
                  {r.imported_views ? ` (${r.imported_views} from Loom)` : ''}
                  {r.size_bytes ? ' · ' + fmtSize(r.size_bytes) : ''}
                  {r.status !== 'ready' ? ` · ${r.status}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <a href={r.share_path} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}>Open</a>
                <button onClick={() => copyLink(r)}
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Copy link</button>
                {!r.has_transcript && (
                  <button onClick={() => transcribeOne(r)} title="Generate a transcript"
                    style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Transcribe</button>
                )}
                <button onClick={() => remove(r)}
                  style={{ padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', color: 'var(--negative)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
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

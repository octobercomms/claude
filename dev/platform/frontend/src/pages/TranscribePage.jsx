import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

// Produce → Transcribe. Upload an audio file; ElevenLabs Scribe transcribes it
// with speaker separation; the AM names each detected voice, then reads/copies/
// downloads the final labelled transcript. Embedded in ClientVideoTab.

function fmtTime(s) {
  if (s == null || isNaN(s)) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Display label for a speaker id: the name the AM gave, else "Speaker N".
function labelFor(speaker, names, speakers) {
  if (names && names[speaker]) return names[speaker];
  const i = speakers.indexOf(speaker);
  return `Speaker ${i >= 0 ? i + 1 : '?'}`;
}

export default function TranscribePage({ embedded = false, clientId = null } = {}) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null); // full transcript row
  const [uploading, setUploading] = useState(false);
  const [names, setNames] = useState({});       // local edits to speaker names
  const [editingNames, setEditingNames] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  function loadList() {
    api.get(`/transcripts${clientId ? `?client_id=${clientId}` : ''}`).then((r) => setList(r.items || [])).catch(() => {});
  }
  useEffect(() => { loadList(); return () => clearTimeout(pollRef.current); /* eslint-disable-next-line */ }, [clientId]);

  // Poll while a transcript is processing.
  useEffect(() => {
    clearTimeout(pollRef.current);
    if (current && current.status === 'processing') {
      pollRef.current = setTimeout(() => {
        api.get(`/transcripts/${current.id}`).then((t) => { setCurrent(t); if (t.status !== 'processing') loadList(); }).catch(() => {});
      }, 4000);
    }
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  async function open(id) {
    try { const t = await api.get(`/transcripts/${id}`); setCurrent(t); setNames(t.speaker_names || {}); setEditingNames(!t.named); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function onPick(e) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      fd.append('title', f.name);
      if (clientId) fd.append('client_id', clientId);
      const t = await api.postForm('/transcripts', fd);
      setCurrent(t); setNames({}); setEditingNames(true);
      loadList();
      toast('Uploaded — transcribing with speaker separation…', 'success');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'error'); }
    finally { setUploading(false); }
  }

  async function saveNames() {
    try {
      const t = await api.patch(`/transcripts/${current.id}/speakers`, { names });
      setCurrent(t); setEditingNames(false); loadList();
      toast('Voices named — here’s your transcript.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function retry() {
    try { await api.post(`/transcripts/${current.id}/retry`, {}); setCurrent({ ...current, status: 'processing', error: null }); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    if (!window.confirm('Delete this transcript and its audio? Cannot be undone.')) return;
    try { await api.delete(`/transcripts/${id}`); if (current?.id === id) setCurrent(null); loadList(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function transcriptText() {
    const speakers = current.speakers || [];
    return (current.segments || []).map((s) => `${labelFor(s.speaker, current.speaker_names, speakers)}: ${s.text}`).join('\n\n');
  }
  function copyText() { navigator.clipboard?.writeText(transcriptText()).then(() => toast('Transcript copied.', 'success')).catch(() => {}); }
  function downloadText() {
    const blob = new Blob([transcriptText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(current.title || 'transcript').replace(/\.[a-z0-9]+$/i, '')}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const speakers = current?.speakers || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: embedded ? '260px 1fr' : '300px 1fr', gap: 'var(--s4)', alignItems: 'start' }}>
      {/* Left: upload + history */}
      <div>
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <h3 className="h3 mb-2">Transcribe audio</h3>
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', margin: '0 0 var(--s3)' }}>
            Upload a recording (m4a, mp3, wav…). We transcribe it and separate each speaker — then you name the voices.
          </p>
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm" style={{ display: 'none' }} onChange={onPick} />
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => fileRef.current?.click(), disabled: uploading })}>
            {uploading ? 'Uploading…' : '⬆ Upload audio'}
          </button>
        </div>

        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 var(--s2)' }}>Recent</div>
        {!list.length && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>No transcripts yet.</div>}
        {list.map((t) => (
          <div key={t.id} onClick={() => open(t.id)}
            style={{ padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', marginBottom: 'var(--s2)', cursor: 'pointer',
              background: current?.id === t.id ? 'var(--surface-raised)' : 'var(--surface)' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
              {t.status === 'processing' ? '⏳ transcribing…' : t.status === 'error' ? '⚠ failed' : `${t.speakers.length} voice${t.speakers.length === 1 ? '' : 's'}${t.named ? '' : ' · needs naming'}`}
            </div>
          </div>
        ))}
      </div>

      {/* Right: current transcript */}
      <div>
        {!current && (
          <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>
            Upload an audio file to get started, or pick a recent transcript on the left.
          </div>
        )}

        {current && current.status === 'processing' && (
          <div className="card">
            <h3 className="h3 mb-2">{current.title}</h3>
            <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-subtle)' }}>⏳ Transcribing and separating speakers… this can take a minute or two for a long file. This page updates itself.</p>
          </div>
        )}

        {current && current.status === 'error' && (
          <div className="card">
            <h3 className="h3 mb-2">{current.title}</h3>
            <div style={{ padding: 'var(--s3)', background: 'var(--negative-soft)', border: '1px solid #f5c6cb', color: 'var(--negative)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)', marginBottom: 'var(--s3)' }}>
              Transcription failed: {current.error || 'unknown error'}
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

            {/* Name the voices step */}
            {(editingNames || !current.named) ? (
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Name the voices</div>
                <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', margin: '0 0 var(--s3)' }}>
                  We detected {speakers.length} distinct voice{speakers.length === 1 ? '' : 's'}. Name each one — a sample of what they said is shown to help.
                </p>
                {speakers.map((sp, i) => (
                  <div key={sp} style={{ marginBottom: 'var(--s3)' }}>
                    <label className="field" style={{ marginBottom: 'var(--s1)' }}>
                      <span className="field-label">Speaker {i + 1}</span>
                      <input className="input" value={names[sp] || ''} placeholder={`e.g. ${i === 0 ? 'Daniel' : 'Jane'}`}
                        onChange={(e) => setNames((n) => ({ ...n, [sp]: e.target.value }))} />
                    </label>
                    {current.speaker_samples?.[sp] && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', fontStyle: 'italic', paddingLeft: 'var(--s1)' }}>“{current.speaker_samples[sp]}…”</div>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                  <button className="btn btn-primary" {...roWrite(readOnly, { onClick: saveNames })}>Save names &amp; view transcript</button>
                  {current.named && <button className="btn btn-secondary" onClick={() => setEditingNames(false)}>Cancel</button>}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={copyText}>Copy</button>
                  <button className="btn btn-secondary btn-sm" onClick={downloadText}>Download .txt</button>
                  <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => { setNames(current.speaker_names || {}); setEditingNames(true); } })}>Edit names</button>
                </div>
                <div style={{ maxHeight: 520, overflow: 'auto', paddingRight: 'var(--s2)' }}>
                  {(current.segments || []).map((s, i) => (
                    <div key={i} style={{ marginBottom: 'var(--s3)' }}>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text)' }}>
                        {labelFor(s.speaker, current.speaker_names, speakers)}
                        {s.start != null && <span style={{ color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 'var(--s2)' }}>{fmtTime(s.start)}</span>}
                      </div>
                      <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.5 }}>{s.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Social → Reels. The AI video suite (Phase 1): pick a HeyGen avatar / Digital
// Twin + voice, type a script, and HeyGen renders a captioned vertical reel.
// Renders async, so the panel polls while any reel is still processing.

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS = {
  queued:     { label: 'Queued',      cls: 'chip-neutral' },
  processing: { label: 'Rendering…',  cls: 'chip-accent' },
  completed:  { label: 'Ready',       cls: 'chip-success' },
  failed:     { label: 'Failed',      cls: 'chip-warning' },
};

export default function HeygenReelsPanel({ clientId, draft, onScheduled }) {
  const toast = useToast();
  const [opts, setOpts] = useState(null);   // { avatars, voices } | null
  const [optsErr, setOptsErr] = useState(null);
  const [reels, setReels] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  // Pre-fill from a post pushed in via "Make avatar reel" (keyed on draft.ts).
  useEffect(() => {
    if (draft) { setTitle(draft.title || ''); setScript(draft.script || ''); }
  }, [draft?.ts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [avatar, setAvatar] = useState('');
  const [voice, setVoice] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [fit, setFit] = useState('cover');            // cover = fill the frame
  const [expressiveness, setExpressiveness] = useState('medium'); // photo avatars
  const [engine, setEngine] = useState('');           // '' = Avatar IV (default)
  const [speed, setSpeed] = useState(1);               // voice_settings.speed
  const [pauseDur, setPauseDur] = useState('0.5s');    // explicit pause length
  const [caption, setCaption] = useState(true);        // burn subtitles in
  const [modalReel, setModalReel] = useState(null);    // reel open in the viewer
  const [scriptTopic, setScriptTopic] = useState('');  // brief for Claude
  const [scriptLen, setScriptLen] = useState(60);      // target seconds
  const [writingScript, setWritingScript] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  // Video shapes HeyGen renders. Label + the platform each suits.
  const SHAPES = [
    { id: '9:16', label: 'Reel / Story', dim: '1080×1920' },
    { id: '4:5',  label: 'Portrait post', dim: '1080×1350' },
    { id: '1:1',  label: 'Square post',  dim: '1080×1080' },
    { id: '16:9', label: 'Landscape',    dim: '1920×1080' },
  ];

  async function loadReels() {
    try { const r = await api.get(`/heygen/clients/${clientId}/heygen/reels`); setReels(r.reels || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  const [reloadingOpts, setReloadingOpts] = useState(false);
  async function loadOptions() {
    setReloadingOpts(true); setOptsErr(null);
    try {
      const r = await api.get(`/heygen/clients/${clientId}/heygen/options`);
      setOpts(r);
      if (r.avatars?.length) setAvatar(`${r.avatars[0].type}:${r.avatars[0].id}`);
      if (r.voices?.length) setVoice(r.voices[0].id);
    } catch (e) { setOptsErr(e.message); }
    finally { setReloadingOpts(false); }
  }
  useEffect(() => { loadOptions(); loadReels(); /* eslint-disable-next-line */ }, [clientId]);

  useEffect(() => {
    const pending = reels.some(r => r.status === 'processing' || r.status === 'queued');
    clearInterval(pollRef.current);
    if (pending) pollRef.current = setInterval(loadReels, 8000);
    return () => clearInterval(pollRef.current);
    /* eslint-disable-next-line */
  }, [reels]);

  async function generate() {
    if (!script.trim()) { toast('Write a script for your avatar to say.', 'error'); return; }
    if (!avatar || !voice) { toast('Pick an avatar and a voice.', 'error'); return; }
    const [avatar_type, avatar_id] = avatar.split(':');
    const avatar_name = opts?.avatars?.find(a => a.id === avatar_id)?.name || null;
    setBusy(true);
    try {
      // fit/engine/expressiveness are gated server-side (engine only applies as
      // avatar_v, expressiveness only for photo avatars), so it's safe to send.
      const reel = await api.post(`/heygen/clients/${clientId}/heygen/reels`, { title: title.trim(), script: script.trim(), avatar_id, avatar_type, avatar_name, voice_id: voice, caption, aspect, fit, engine: engine || undefined, expressiveness, speed });
      setReels(prev => [reel, ...prev]);
      setScript(''); setTitle('');
      toast('Sent to HeyGen — rendering. It’ll appear below in a minute or two.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function refresh(id) {
    try { const r = await api.post(`/heygen/clients/${clientId}/heygen/reels/${id}/refresh`, {}); setReels(prev => prev.map(x => x.id === id ? r : x)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function retry(id) {
    try { const r = await api.post(`/heygen/clients/${clientId}/heygen/reels/${id}/retry`, {}); setReels(prev => [r, ...prev.filter(x => x.id !== id)]); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function writeScript() {
    setWritingScript(true);
    try {
      const res = await api.post(`/heygen/clients/${clientId}/heygen/script`, { topic: scriptTopic.trim(), seconds: scriptLen });
      setScript(res.script);
      if (!title.trim() && scriptTopic.trim()) setTitle(scriptTopic.trim().slice(0, 80));
      toast('Script written — edit it, then generate your reel.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setWritingScript(false); }
  }
  async function schedule(id) {
    try {
      const res = await api.post(`/heygen/clients/${clientId}/heygen/reels/${id}/schedule`, {});
      setModalReel(null);
      if (res?.drive_warning) {
        toast(`Added to Plan as a draft, but the video didn't attach to Drive: ${res.drive_warning}`, 'error');
      } else {
        toast('Added to Plan with the reel attached — set the date & platforms in the Plan step.', 'success');
      }
      onScheduled?.();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    if (!window.confirm('Delete this reel?')) return;
    try { await api.delete(`/heygen/clients/${clientId}/heygen/reels/${id}`); setReels(prev => prev.filter(x => x.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  // v3-specific: which extra controls apply to the selected avatar.
  const selAvatar = opts?.avatars?.find(a => `${a.type}:${a.id}` === avatar);
  const isPhoto = selAvatar?.type === 'photo_avatar';
  const canAvatarV = (selAvatar?.engines || []).includes('avatar_v');

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>AI reels.</strong> Pick your Digital Twin (or a stock avatar) + a voice, type a script, and HeyGen renders a captioned vertical reel. Pay-as-you-go (~$1/min). Create your Digital Twin in the HeyGen app — it then shows up in the avatar list here.
      </div>

      {optsErr ? (
        <div className="callout callout-warning" style={{ marginBottom: 'var(--s5)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{optsErr}</span>
          <button onClick={loadOptions} disabled={reloadingOpts} className="btn btn-secondary btn-sm">{reloadingOpts ? 'Retrying…' : 'Retry'}</button>
        </div>
      ) : !opts ? (
        <div className="text-subtle" style={{ marginBottom: 'var(--s5)' }}>Loading avatars & voices…</div>
      ) : (
        <div className="card" style={{ marginBottom: 'var(--s5)' }}>
          {opts.partial && (
            <div className="callout callout-warning" style={{ marginBottom: 'var(--s4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{opts.avatars?.length ? 'Voices' : 'Avatars'} couldn’t load — {opts.partial_error || 'HeyGen may be busy.'}</span>
              <button onClick={loadOptions} disabled={reloadingOpts} className="btn btn-secondary btn-sm">{reloadingOpts ? 'Retrying…' : 'Retry'}</button>
            </div>
          )}
          <div className="stack stack-sm">
            {/* Let Claude write the script at a chosen length — the target
                duration is what sets the finished video's runtime. */}
            <div style={{ padding: 'var(--s3)', border: 'var(--border-w) dashed var(--card-border)', borderRadius: 'var(--r-sm)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="field-label" style={{ margin: 0 }}>✨ Write with Claude</span>
              <input className="input" style={{ flex: '1 1 220px', minWidth: 160 }} placeholder="Topic / brief (optional — uses the client's brief if blank)"
                value={scriptTopic} onChange={e => setScriptTopic(e.target.value)} />
              <select className="input" style={{ width: 'auto' }} value={scriptLen} onChange={e => setScriptLen(Number(e.target.value))} title="Target length sets the video's runtime">
                <option value={30}>~30s</option>
                <option value={60}>~1 min</option>
                <option value={90}>~90s</option>
                <option value={120}>~2 min</option>
                <option value={180}>~3 min</option>
              </select>
              <button type="button" className="btn btn-secondary btn-sm" onClick={writeScript} disabled={writingScript}>
                {writingScript ? 'Writing…' : 'Write script'}
              </button>
            </div>
            <input className="input" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="input" rows={9} placeholder="Script — what should your avatar say? (write as long as you like — up to ~3-minute explainers)" value={script} onChange={e => setScript(e.target.value)} />
            {(() => {
              const words = script.trim() ? script.trim().split(/\s+/).filter(Boolean).length : 0;
              if (!words) return null;
              const sec = Math.round(words / 2.5); // ~150 wpm
              const dur = sec >= 60 ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s` : `${sec}s`;
              return (
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: -2 }}>
                  {words} words · ≈ {dur} spoken{sec >= 90 ? ` · ≈ $${(sec / 60).toFixed(2)} at ~$1/min` : ''}
                </div>
              );
            })()}
            {(() => {
              const canPause = !!opts.voices.find(v => v.id === voice)?.supportsPause;
              return (
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.6, marginTop: -4 }}>
                  {canPause ? (
                    <>Pacing: drop a pause of{' '}
                      <select value={pauseDur} onChange={e => setPauseDur(e.target.value)}
                        style={{ fontSize: 11, padding: '1px 4px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 4 }}>
                        {['0.3s', '0.5s', '1s', '1.5s', '2s'].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>{' '}
                      <button type="button" className="btn-inline-link"
                        onClick={() => setScript(s => (s ? `${s.trimEnd()} [pause ${pauseDur}] ` : `[pause ${pauseDur}] `))}>Insert pause</button>
                      , or emphasise words by wrapping them in <code>*asterisks*</code>.
                    </>
                  ) : (
                    <>This voice doesn't support pauses — pick a voice marked <strong>⏸ pauses</strong> below for pause &amp; emphasis control.</>
                  )}
                </div>
              );
            })()}
            <div>
              <span className="field-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>Avatar / Digital Twin{avatar && opts.avatars.find(a => `${a.type}:${a.id}` === avatar) ? ` — ${opts.avatars.find(a => `${a.type}:${a.id}` === avatar).name}` : ''}</span>
                <button type="button" onClick={loadOptions} disabled={reloadingOpts}
                  className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} title="Pull your latest avatars from HeyGen">
                  {reloadingOpts ? 'Syncing…' : '↻ Sync'}
                </button>
              </span>
              {!opts.avatars.length ? (
                <div className="body-sm text-subtle" style={{ marginTop: 6 }}>No avatars — make a Digital Twin in HeyGen, then Sync.</div>
              ) : (
                <div className="avatar-grid">
                  {opts.avatars.map((a, i) => {
                    const val = `${a.type}:${a.id}`;
                    return (
                      <button type="button" key={val} onClick={() => setAvatar(val)} title={a.name}
                        className={'avatar-thumb' + (avatar === val ? ' sel' : '')}>
                        {a.preview ? <img src={a.preview} alt={a.name} loading="lazy" /> : <div className="avatar-thumb-ph">{i + 1}</div>}
                        <span className="avatar-thumb-n">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <label className="field" style={{ display: 'block' }}>
              <span className="field-label">Voice</span>
              <select className="input" value={voice} onChange={e => setVoice(e.target.value)}>
                {opts.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.isPrivate ? ' · your voice' : ''}{v.language ? ` · ${v.language}` : ''}{v.supportsPause ? ' · ⏸ pauses' : ''}</option>)}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Shape</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SHAPES.map(s => (
                  <button type="button" key={s.id} onClick={() => setAspect(s.id)}
                    className={'btn btn-sm ' + (aspect === s.id ? 'btn-primary' : 'btn-secondary')}
                    title={s.dim}>
                    {s.label} · {s.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Framing</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setFit('cover')}
                  className={'btn btn-sm ' + (fit === 'cover' ? 'btn-primary' : 'btn-secondary')}
                  title="Scale the avatar to fill the whole frame (may crop the edges)">Fill frame</button>
                <button type="button" onClick={() => setFit('contain')}
                  className={'btn btn-sm ' + (fit === 'contain' ? 'btn-primary' : 'btn-secondary')}
                  title="Fit the whole avatar inside the frame (may show background bars)">Fit whole avatar</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                <strong>Fill</strong> stops a reel from letterboxing the avatar into a smaller box.
              </div>
            </div>
            <div className="field">
              <span className="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Speed</span>
                <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>{speed === 1 ? 'Normal' : `${speed.toFixed(2)}×`}</span>
              </span>
              <input type="range" min="0.5" max="1.5" step="0.05" value={speed}
                onChange={e => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                Overall delivery pace. Combine with pauses above for finer control.
              </div>
            </div>
            {isPhoto && (
              <label className="field" style={{ display: 'block' }}>
                <span className="field-label">Expressiveness</span>
                <select className="input" value={expressiveness} onChange={e => setExpressiveness(e.target.value)}>
                  <option value="low">Low — calm, minimal motion</option>
                  <option value="medium">Medium — natural</option>
                  <option value="high">High — lively, more gesture</option>
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  Photo avatars only. HeyGen defaults to Low (stiff) — Medium/High give more lifelike motion.
                </div>
              </label>
            )}
            {canAvatarV && (
              <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={engine === 'avatar_v'} onChange={e => setEngine(e.target.checked ? 'avatar_v' : '')} />
                <span style={{ fontSize: 13 }}>
                  <strong>Highest fidelity (Avatar V)</strong>{' '}
                  <span style={{ color: 'var(--text-subtle)' }}>— best lip-sync for this Digital Twin. Costs a little more.</span>
                </span>
              </label>
            )}
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={caption} onChange={e => setCaption(e.target.checked)} />
              <span style={{ fontSize: 13 }}>
                <strong>Burn in captions</strong>{' '}
                <span style={{ color: 'var(--text-subtle)' }}>— subtitles baked into the video (recommended for silent autoplay).</span>
              </span>
            </label>
            <div><button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'Sending…' : '✦ Generate reel'}</button></div>
          </div>
        </div>
      )}

      {!reels.length ? (
        <p className="body-sm text-subtle">No reels yet — write a script above to make your first.</p>
      ) : (
        <>
          <div className="field-label" style={{ marginBottom: 'var(--s3)' }}>Your reels · {reels.length}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--s4)' }}>
            {reels.map(r => {
              const st = STATUS[r.status] || STATUS.queued;
              const done = r.status === 'completed' && r.video_url;
              const label = r.title || (r.script || '').slice(0, 50) + ((r.script || '').length > 50 ? '…' : '');
              return (
                <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
                  <button type="button" onClick={() => remove(r.id)} title="Delete"
                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, width: 22, height: 22, borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>✕</button>
                  <div
                    onClick={() => done && setModalReel(r)}
                    style={{ position: 'relative', aspectRatio: '9 / 16', background: '#000', cursor: done ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {done ? (
                      <>
                        <video src={r.video_url} preload="metadata" muted playsInline
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>▶</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12, padding: 12 }}>
                        {r.status === 'failed' ? '⚠︎ Failed' : '⏳ Rendering…'}
                      </div>
                    )}
                    <span className={`chip ${st.cls}`} style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 9 }}>{st.label}</span>
                  </div>
                  <div style={{ padding: 'var(--s3)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                    <div className="body-xs text-subtle" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.avatar_name || r.avatar_id}{r.duration_s ? ` · ${Math.round(r.duration_s)}s` : ''}
                    </div>
                    {r.status === 'failed' && <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={() => retry(r.id)}>Retry</button>}
                    {r.status === 'processing' && <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => refresh(r.id)}>Refresh</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {modalReel && (
        <div onClick={() => setModalReel(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} className="card"
            style={{ maxWidth: 380, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{modalReel.title || 'Reel'}</strong>
                <div className="body-xs text-subtle">{modalReel.avatar_name || modalReel.avatar_id}{modalReel.duration_s ? ` · ${Math.round(modalReel.duration_s)}s` : ''}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setModalReel(null)}>✕</button>
            </div>
            <video src={modalReel.video_url} controls autoPlay
              style={{ width: '100%', borderRadius: 'var(--r-sm)', background: '#000', maxHeight: '64vh' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => schedule(modalReel.id)}>📅 Schedule</button>
              <a className="btn btn-secondary btn-sm" href={modalReel.video_url} target="_blank" rel="noreferrer" download>Download</a>
              <button className="btn btn-ghost btn-sm" onClick={() => { remove(modalReel.id); setModalReel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

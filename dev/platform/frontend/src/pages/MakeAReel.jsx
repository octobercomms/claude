import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import AssetLibrary from '../components/AssetLibrary';
import CaptionTemplates from '../components/CaptionTemplates';
import ReelChecks from '../components/ReelChecks';
import TightenEdit from '../components/TightenEdit';
import BrollPlan from '../components/BrollPlan';

/**
 * One route through the tools, in the order a reel is actually made.
 *
 * Every step here already existed and every one of them worked. What did not
 * exist was the path: captions were chosen in Edit, the pauses were cut from
 * inside the Library behind a thumbnail nobody thinks to click, and the two
 * best tools in Produce were invisible unless you already knew they were
 * there. A tool nobody finds is a tool nobody has.
 *
 * So this owns no pipeline of its own. It mounts the same panels in sequence,
 * carries one clip between them, and lets any step be skipped, because an
 * operator who already knows the way round should never be made to walk a
 * wizard. The Library tab keeps working exactly as it did.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

const STEPS = [
  { key: 'footage', label: 'Footage', hint: 'What are we starting with?' },
  { key: 'edit', label: 'Edit', hint: 'Shape, sound and captions' },
  { key: 'tighten', label: 'Tighten', hint: 'Take out the dead air' },
  { key: 'broll', label: 'B-roll', hint: 'Cut away where it helps' },
  { key: 'done', label: 'Finish', hint: 'Where it went' },
];

const ASPECTS = [
  { key: '9:16', label: 'Reel 9:16' },
  { key: '1:1', label: 'Square 1:1' },
  { key: '4:5', label: 'Portrait 4:5' },
  { key: 'original', label: 'Leave it' },
];

function Rail({ at, onJump, reached }) {
  return (
    <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
      {STEPS.map((s, i) => {
        const here = s.key === at;
        const been = reached.includes(s.key);
        return (
          <button key={s.key} type="button" disabled={!been}
            onClick={() => been && onJump(s.key)}
            style={{
              border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s2) var(--s3)',
              background: here ? 'var(--accent-soft, var(--surface))' : 'transparent',
              cursor: been ? 'pointer' : 'default', opacity: been ? 1 : 0.45,
              textAlign: 'left', minWidth: 132,
            }}>
            <span style={{ ...CAP, display: 'block' }}>Step {i + 1}</span>
            <span style={{ fontWeight: 700 }}>{s.label}</span>
            <span style={{ ...CAP, display: 'block', lineHeight: 1.3 }}>{s.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function MakeAReel({ clientId, clientName = '' }) {
  const [at, setAt] = useState('footage');
  const [reached, setReached] = useState(['footage']);
  const [clip, setClip] = useState(null);        // the asset being worked on
  const [words, setWords] = useState(null);      // paid for once, shared below
  const [error, setError] = useState(null);

  // step 2 state
  const [aspect, setAspect] = useState('9:16');
  const [cleanAudio, setCleanAudio] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [template, setTemplate] = useState(null);
  const [templateName, setTemplateName] = useState(null);
  const [picking, setPicking] = useState(false);
  const [job, setJob] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);

  const go = (key) => {
    setAt(key);
    setReached((r) => (r.includes(key) ? r : [...r, key]));
  };

  // While an edit renders, ask for it until it is done. The queue is
  // server-side and a render outlives any one page, so this is a poll rather
  // than a socket: it is a handful of requests over a minute, and it has to
  // survive a reload.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return undefined;
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/edit/clients/${clientId}/edit/${job.id}`);
        setJob(r);
        if (r.status === 'done') {
          // The library row the render produced, found by the job's own id
          // rather than by taking the newest asset and hoping.
          const asset = await api.get(
            `/clients/${clientId}/assets/by-source/edit_job/${r.id}`).catch(() => null);
          if (asset) { setClip(asset); setWords(null); go('tighten'); }
        }
        if (r.status === 'failed') setError(r.error || 'The render failed.');
      } catch { /* keep trying; a blip is not a failure */ }
    }, 4000);
    return () => clearInterval(t);
  }, [job, clientId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Both ways in end at the same place: a draft edit job holding the footage.
  // The editor works on files in its own directory, so a library asset is
  // copied in rather than referenced across stores.
  async function startFromUpload(file) {
    setBusy('upload'); setError(null);
    try {
      const fd = new FormData();
      fd.append('files', file);
      fd.append('ops', JSON.stringify({}));
      fd.append('draft', 'true');
      const draft = await api.postForm(`/edit/clients/${clientId}/edit`, fd);
      setDraftId(draft.id);
      setClip({ id: draft.id, title: file.name, kind: 'video', client_id: clientId });
      go('edit');
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function startFromAsset(asset) {
    setBusy('pick'); setError(null);
    try {
      const draft = await api.post(`/edit/clients/${clientId}/edit/from-asset`,
        { asset_id: asset.id });
      setDraftId(draft.id);
      setClip(asset);
      setWords(null);
      go('edit');
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  // reopen is the existing "render this again with these settings" primitive:
  // it copies the draft's footage into a fresh job carrying the chosen ops and
  // queues it. Rendering a draft in place would use the ops it was created
  // with, which are empty.
  async function render() {
    setBusy('render'); setError(null);
    try {
      const ops = { aspect, clean_audio: cleanAudio, captions,
        caption_template: captions ? template : null,
        caption_style: { size: 'medium', pos: 0 } };
      const queued = await api.post(`/edit/clients/${clientId}/edit/${draftId}/reopen`, { ops });
      setJob(queued);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  const card = { marginTop: 'var(--s4)' };

  return (
    <div>
      <Rail at={at} reached={reached} onJump={setAt} />
      {error && (
        <div className="card" style={{ ...card, color: 'var(--negative)' }}>{error}</div>
      )}

      {at === 'footage' && (
        <div className="card" style={card}>
          <div style={{ fontWeight: 700 }}>Start with a clip</div>
          <div style={{ ...CAP, marginTop: 4, lineHeight: 1.5 }}>
            A piece to camera, a voiceover, anything with speech in it. Everything after this
            step reads the words, so a clip with no speech only gets as far as the edit.
          </div>

          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={!!busy}
              onClick={() => fileRef.current?.click()}>
              {busy === 'upload' ? 'Uploading…' : 'Upload a clip'}
            </button>
            <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && startFromUpload(e.target.files[0])} />
            <span style={CAP}>or pick something already made for {clientName || 'this client'}:</span>
          </div>

          <div style={{ marginTop: 'var(--s3)' }}>
            <AssetLibrary clientId={clientId} kind="video" compact
              title="This client's footage"
              onPick={(a) => startFromAsset(a)} />
          </div>
        </div>
      )}

      {at === 'edit' && clip && (
        <>
          <div className="card" style={card}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
              gap: 'var(--s2)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>{clip.title || 'Your clip'}</span>
              <button type="button" className="btn btn-ghost btn-sm"
                style={{ color: 'var(--text-subtle)' }} onClick={() => go('footage')}>
                Start with something else
              </button>
            </div>

            <div style={{ marginTop: 'var(--s3)' }}>
              <div style={{ ...CAP, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
                Format
              </div>
              <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
                {ASPECTS.map((a) => (
                  <button key={a.key} className={`btn btn-sm ${aspect === a.key ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAspect(a.key)}>{a.label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 'var(--s3)', display: 'grid', gap: 'var(--s2)' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={cleanAudio}
                  onChange={(e) => setCleanAudio(e.target.checked)} />
                Clean audio <span style={CAP}>denoise and level out the volume</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={captions}
                  onChange={(e) => setCaptions(e.target.checked)} />
                Captions <span style={CAP}>burned on, plus a .srt file</span>
              </label>
            </div>

            {captions && (
              <div style={{ marginTop: 'var(--s2)', paddingLeft: 'var(--s5)' }}>
                <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={CAP}>Style</span>
                  <strong>{template ? (templateName || template) : 'Plain'}</strong>
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setPicking((v) => !v)}>
                    {picking ? 'Close' : template ? 'Change' : 'Choose a template'}
                  </button>
                  {template && (
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--text-subtle)' }}
                      onClick={() => { setTemplate(null); setTemplateName(null); }}>
                      Back to plain
                    </button>
                  )}
                </div>
                {picking && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <CaptionTemplates clientId={clientId} value={template}
                      format={aspect === '1:1' || aspect === '4:5' ? 'square' : 'vertical'}
                      onChange={(id, t) => {
                        setTemplate(id); setTemplateName(t?.name || null); setPicking(false);
                      }} />
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 'var(--s4)' }}>
              <button className="btn btn-primary" disabled={!!busy || !!job}
                onClick={render}>
                {job ? 'Rendering…' : busy === 'render' ? 'Starting…' : 'Render it'}
              </button>
              {job && (
                <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>
                  Rendering on the server. You can close this and come back; it carries on
                  without you, and the finished clip lands in the Library either way.
                </div>
              )}
            </div>
          </div>

          {/* The checks sit beside the decision, as they do in Edit. The four
              that read the words wait for the transcript, which does not exist
              until this renders. */}
          <div className="card" style={card}>
            <ReelChecks clientId={clientId} timings={[]}
              edit={{ duration_s: clip.duration_s || null,
                caption_template: captions ? (template || 'plain') : null,
                brand: clientName }} />
          </div>
        </>
      )}

      {at === 'tighten' && clip && (
        <>
          {/* Which clip. By this point the operator has moved from the footage
              they chose to a rendered version of it, and a panel that never
              says so leaves them editing something they cannot name. */}
          <div style={{ ...CAP, marginTop: 'var(--s3)' }}>
            Working on <strong>{clip.title || 'your clip'}</strong>
            {clip.duration_s ? ` · ${Math.round(clip.duration_s)}s` : ''}
          </div>
          <div className="card" style={card}>
            <TightenEdit key={clip.id} asset={clip} onWords={setWords}
              onTightened={(a) => { if (a) setClip(a); }} />
          </div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-primary btn-sm" onClick={() => go('broll')}>
              Next: b-roll
            </button>
            <span style={CAP}>Nothing to cut? Go straight on.</span>
          </div>
        </>
      )}

      {at === 'broll' && clip && (
        <>
          <div style={{ ...CAP, marginTop: 'var(--s3)' }}>
            Working on <strong>{clip.title || 'your clip'}</strong>
            {clip.duration_s ? ` · ${Math.round(clip.duration_s)}s` : ''}
          </div>
          <div className="card" style={card}>
            <BrollPlan key={`b-${clip.id}`} asset={clip} clientId={clientId} words={words}
              onRendered={(a) => { if (a) setClip(a); }} />
          </div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-primary btn-sm" onClick={() => go('done')}>
              Finish
            </button>
            <span style={CAP}>No cutaways wanted? Finish here.</span>
          </div>
        </>
      )}

      {at === 'done' && (
        <div className="card" style={card}>
          <div style={{ fontWeight: 700 }}>Done</div>
          <div style={{ marginTop: 'var(--s2)', lineHeight: 1.6 }}>
            <strong>{clip?.title || 'Your reel'}</strong> is in the Library, with every version
            you made along the way. Nothing was overwritten, so the original and each step are
            all still there to compare.
          </div>
          <div style={{ ...CAP, marginTop: 'var(--s3)', lineHeight: 1.5 }}>
            To schedule it, go to Shared and attach it to a post. The library is where Shared
            reads from, so it is already available there.
          </div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              setClip(null); setWords(null); setJob(null); setDraftId(null);
              setTemplate(null); setTemplateName(null);
              setReached(['footage']); setAt('footage');
            }}>Make another</button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';

/**
 * The caption template library, read against one client's brand kit.
 *
 * Two things this screen is built around:
 *
 * 1. The grid paints its own swatches from the template rows, so showing
 *    twenty-seven options costs no renders. Only the one you select is drawn,
 *    and only as a still frame.
 *
 * 2. It shows what the client's kit DID and what it refused. A brand colour
 *    that cannot be read over footage is left out, and a screen that silently
 *    ignored it would have the operator wondering why their client's orange
 *    never appears.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

/**
 * What the template looks like.
 *
 * Two modes, and the difference matters. The swatch is drawn from the template
 * row, so showing twenty-seven costs nothing. The example is the template
 * burned over real footage, which is the only thing that answers the questions
 * an operator actually has: does it clear the speaker's face, does it hold up
 * over a bright shot, is the motion too much for this client.
 *
 * Examples are muted, looping and play on hover, because twenty-seven clips all
 * playing at once is unreadable and twenty-seven that need clicking is worse.
 */
function Swatch({ sw, font, active, exampleSrc }) {
  const ref = useRef(null);
  const box = {
    height: exampleSrc ? 150 : 72, borderRadius: 'var(--r-sm)', border: LINE,
    background: 'var(--surface-sunken, #141414)', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
  };
  if (exampleSrc) {
    return (
      <div style={box}
        onMouseEnter={() => ref.current?.play().catch(() => {})}
        onMouseLeave={() => { if (ref.current) { ref.current.pause(); ref.current.currentTime = 2.4; } }}>
        <video ref={ref} src={exampleSrc} muted loop playsInline preload="metadata"
          // Land on a word rather than between two, or every example shows the
          // template at rest and they all look the same.
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = 2.4; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={box}>
      <span style={{ fontFamily: `"${font}", system-ui`, fontWeight: 800, fontSize: 17, letterSpacing: -0.2 }}>
        <span style={{ color: sw.accent }}>custom</span>
        <span style={{ color: sw.ink, marginLeft: 5 }}>art</span>
      </span>
    </div>
  );
}

export default function CaptionTemplates({ clientId, value, onChange, format = 'vertical' }) {
  const [templates, setTemplates] = useState([]);
  const [kit, setKit] = useState(null);
  const [error, setError] = useState(null);
  const [withKit, setWithKit] = useState(true);
  const [filter, setFilter] = useState('');
  const [sample, setSample] = useState(null);     // is there a clip to render examples over
  const [showExamples, setShowExamples] = useState(true);
  const [uploading, setUploading] = useState(false);
  const selected = value || null;

  useEffect(() => {
    api.get('/video/caption-templates')
      .then((r) => setTemplates(r.templates || []))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api.get('/video/caption-sample-status').then(setSample).catch(() => setSample(null));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    api.get(`/video/clients/${clientId}/caption-kit`)
      .then(setKit)
      .catch(() => setKit(null));
  }, [clientId]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => `${t.name} ${t.best_for} ${t.font} ${t.animation}`
      .toLowerCase().includes(q));
  }, [templates, filter]);

  // The examples are rendered over the house clip and cached on the server, so
  // the first open of this screen pays for them once and nobody pays again.
  // Keyed on the clip's own timestamp, so replacing it refreshes every example
  // rather than leaving the gallery describing footage nobody uses.
  const exampleFor = (id) => (sample?.uploaded && showExamples
    ? `/api/video/caption-sample/${encodeURIComponent(id)}.mp4`
      + `?v=${encodeURIComponent(sample.updated_at || '')}`
      + (clientId && withKit ? `&client_id=${encodeURIComponent(clientId)}` : '')
    : null);

  // Cache-busting is deliberate: the frame depends on the client's kit, which
  // changes when their brand assets do, and a stale preview is a wrong answer.
  const previewSrc = selected && clientId
    ? `/api/video/clients/${clientId}/caption-preview?template_id=${encodeURIComponent(selected)}`
      + `&format_id=${encodeURIComponent(format)}${withKit ? '' : '&skip_kit=1'}`
    : null;

  if (error) return <div style={{ ...CAP, color: 'var(--negative)' }}>{error}</div>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Caption template</span>
        <span className="row" style={{ gap: 'var(--s2)', alignItems: 'center' }}>
          {sample?.uploaded && (
            <label style={{ ...CAP, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={showExamples}
                onChange={(e) => setShowExamples(e.target.checked)} />
              Show examples
            </label>
          )}
          <input className="input" style={{ width: 180 }} placeholder="Filter…"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </span>
      </div>

      {/* What the client's own kit contributed, and what it could not. */}
      {kit && (
        <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>
          {kit.kit?.font || kit.kit?.accent ? (
            <>
              This client&rsquo;s kit supplies
              {kit.kit.font ? <> the typeface <strong>{kit.kit.font}</strong></> : null}
              {kit.kit.font && kit.kit.accent ? ' and' : null}
              {kit.kit.accent ? (
                <> the accent <strong>{kit.kit.accent}</strong>
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, marginLeft: 5,
                    borderRadius: 2, background: kit.kit.accent,
                  }} />
                </>
              ) : null}.
              {' '}The body text stays near-white with a dark outline whatever the brand is,
              because captions sit over footage nobody has graded.
            </>
          ) : 'No brand kit for this client yet, so templates show as their authors drew them.'}
          {kit.note ? <div style={{ color: 'var(--warning)', marginTop: 2 }}>{kit.note}</div> : null}
          {kit.font_available === false ? (
            <div style={{ marginTop: 2 }}>
              The typeface is a name, not a file. Until the font is uploaded under the
              client&rsquo;s brand assets the render falls back to the template&rsquo;s own.
            </div>
          ) : null}
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={withKit} onChange={(e) => setWithKit(e.target.checked)} />
            Apply the client&rsquo;s kit
          </label>
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 'var(--s2)', marginTop: 'var(--s3)',
      }}>
        {/* The whole row goes back to the caller, not only the id. A caller
            that wants to name the chosen template would otherwise have to
            derive a label from the id, and "institution-soft" is not what the
            gallery calls it. */}
        {shown.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange?.(t.id, t)}
            style={{
              textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
            }}>
            <Swatch sw={t.swatch} font={t.font} active={selected === t.id}
              exampleSrc={exampleFor(t.id)} />
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, marginTop: 4 }}>{t.name}</div>
            <div style={{ ...CAP, lineHeight: 1.35 }}>{t.animation} · {t.font}</div>
            {t.best_for ? <div style={{ ...CAP, lineHeight: 1.35 }}>{t.best_for}</div> : null}
          </button>
        ))}
      </div>
      {!shown.length && templates.length
        ? <div style={{ ...CAP, marginTop: 'var(--s2)' }}>Nothing matches &ldquo;{filter}&rdquo;.</div>
        : null}

      {/* The clip every example is rendered over. One clip for the whole
          platform on purpose: comparing templates is only fair when they are
          all doing the same four seconds. */}
      <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)', borderTop: LINE, lineHeight: 1.5 }}>
        {sample?.uploaded
          ? <>Examples are rendered over the house sample clip, last replaced{' '}
            {new Date(sample.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</>
          : <>No sample clip yet, so the grid shows colour swatches. Upload four seconds of a
            talking head and every template gets a moving example.</>}
        <label className="btn btn-secondary btn-sm" style={{ marginLeft: 'var(--s2)', cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Preparing…' : sample?.uploaded ? 'Replace clip' : 'Upload a clip'}
          <input type="file" accept="video/*" style={{ display: 'none' }} disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setUploading(true);
              try {
                const body = new FormData();
                body.append('file', file);
                await api.postForm('/video/caption-sample-clip', body);
                const next = await api.get('/video/caption-sample-status');
                setSample(next);
              } catch (err) { setError(err.message); } finally { setUploading(false); }
            }} />
        </label>
      </div>

      {previewSrc && (
        <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
          <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>
            One frame, with this client&rsquo;s kit applied. Nothing is rendered or charged until
            you run the project, so changes here are free.
          </div>
          <img src={previewSrc} alt="Caption preview"
            style={{ width: 240, maxWidth: '100%', borderRadius: 'var(--r-sm)', border: LINE, display: 'block' }} />
        </div>
      )}
    </div>
  );
}

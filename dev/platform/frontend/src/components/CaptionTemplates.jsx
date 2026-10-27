import React, { useEffect, useMemo, useState } from 'react';
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

/** What the template looks like, without rendering it. */
function Swatch({ sw, font, active }) {
  return (
    <div style={{
      height: 72, borderRadius: 'var(--r-sm)', border: LINE,
      background: 'var(--surface-sunken, #141414)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
    }}>
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
  const selected = value || null;

  useEffect(() => {
    api.get('/video/caption-templates')
      .then((r) => setTemplates(r.templates || []))
      .catch((e) => setError(e.message));
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
        <input className="input" style={{ width: 200 }} placeholder="Filter…"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
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
        {shown.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange?.(t.id)}
            style={{
              textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
            }}>
            <Swatch sw={t.swatch} font={t.font} active={selected === t.id} />
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, marginTop: 4 }}>{t.name}</div>
            <div style={{ ...CAP, lineHeight: 1.35 }}>{t.animation} · {t.font}</div>
            {t.best_for ? <div style={{ ...CAP, lineHeight: 1.35 }}>{t.best_for}</div> : null}
          </button>
        ))}
      </div>
      {!shown.length && templates.length
        ? <div style={{ ...CAP, marginTop: 'var(--s2)' }}>Nothing matches &ldquo;{filter}&rdquo;.</div>
        : null}

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

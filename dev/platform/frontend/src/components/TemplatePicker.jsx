import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';

/**
 * Choosing one of the eight shipped video templates.
 *
 * A FIELD, not a page. Three placements were written independently and judged
 * through an operator-speed lens and a design-system lens; the lenses split
 * between this and a `Templates` row in Produce, and both ranked a picker
 * inside the editor last — it hangs on an empty composition, so it is shut the
 * moment a clip lands, and it sits on the one screen an unattended batch never
 * opens.
 *
 * The field won because the batch form has to exist anyway, so it costs no
 * navigation, and because it can carry the same editorial payload a gallery
 * would. That payload is the point: `project-reveal` against `hook-cta` is the
 * difference between a practice's work and tech-creator filler, and a
 * `<select>` of eight nouns is how the wrong one gets picked at speed. So each
 * row shows what the template is FOR, the shape of what it wants, and its
 * register.
 *
 * It is a component rather than inline markup so the browse can move later
 * without a second implementation: a `Templates` row would render exactly
 * this. That is the one thing both judges grafted.
 *
 * Expanded on first visit and collapsed to the chosen line afterwards, so the
 * first run IS the gallery and the twelfth is one line.
 */

const KIND_WORDS = {
  clip: ['clip', 'clips'],
  still: ['photograph', 'photographs'],
  design: ['design page', 'design pages'],
  text: ['line of text', 'lines of text'],
  audio: ['audio track', 'audio tracks'],
};

/** "6 to 8 photographs", or "1 audio track". */
function needLine(need) {
  const [one, many] = KIND_WORDS[need.kind] || [need.kind, `${need.kind}s`];
  if (need.max > need.min) return `${need.min} to ${need.max} ${many}`;
  return `${need.min} ${need.min === 1 ? one : many}`;
}

export default function TemplatePicker({ value, onChange, disabled = false }) {
  const [templates, setTemplates] = useState(null);
  const [broken, setBroken] = useState([]);
  const [error, setError] = useState(null);
  // Open until something is chosen. The first run is the browse.
  const [open, setOpen] = useState(!value);

  useEffect(() => {
    let live = true;
    api.get('/compose/templates')
      .then((r) => {
        if (!live) return;
        setTemplates(r.templates || []);
        // Surfaced rather than hidden. A template file that stopped
        // validating is a shape the operator can no longer use, and silence
        // would read as it never having existed.
        setBroken(r.broken || []);
      })
      .catch((e) => { if (live) setError(e.message || 'Could not load the templates.'); });
    return () => { live = false; };
  }, []);

  if (error) return <div className="chip chip-warning">{error}</div>;
  if (!templates) return <div style={{ color: 'var(--text-muted)' }}>Loading the templates…</div>;
  if (!templates.length) {
    return <div className="chip chip-neutral">No templates are installed.</div>;
  }

  const chosen = templates.find((t) => t.id === value) || null;

  if (chosen && !open) {
    return (
      <div className="card" style={{ padding: 'var(--s3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <strong>{chosen.name}</strong>
          <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>
            {chosen.needs.map(needLine).join(', ')}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ padding: 0 }}>
        {templates.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => { onChange(t.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: 'var(--s3)',
                border: 'none',
                borderTop: i === 0 ? 'none' : '1px solid var(--card-border)',
                // The same selected treatment `.search-row.is-cursor`
                // uses, which is the nearest real precedent in the
                // system. There is no reusable selectable-row class to
                // adopt: the contacts list this shape comes from is a
                // `card` with inline styles per row.
                background: selected ? 'var(--accent-soft)' : 'transparent',
                boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none',
                cursor: disabled ? 'default' : 'pointer',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                <strong>{t.name}</strong>
                <span className="chip chip-neutral">{t.register}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
                  {t.size?.width}×{t.size?.height}
                </span>
              </div>
              {/* What it is FOR, which is the thing being chosen. */}
              <div style={{ color: 'var(--text-muted)', marginTop: 'var(--s1)' }}>{t.bestFor}</div>
              <div style={{ marginTop: 'var(--s1)', fontSize: '0.9em' }}>
                Needs {t.needs.map(needLine).join(', ')}
                {t.optional?.length
                  ? ` · optional: ${t.optional.map((o) => (KIND_WORDS[o.kind] || [o.kind])[0]).join(', ')}`
                  : ''}
              </div>
            </button>
          );
        })}
      </div>
      {broken.length > 0 && (
        <div className="chip chip-warning" style={{ marginTop: 'var(--s2)' }}>
          {broken.length} template file{broken.length === 1 ? '' : 's'} could not be read
          and {broken.length === 1 ? 'is' : 'are'} not offered: {broken.map((b) => b.file).join(', ')}
        </div>
      )}
    </div>
  );
}

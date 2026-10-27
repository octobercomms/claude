import React, { useMemo, useState } from 'react';
import { checkReel } from '@shared/reelChecks.mjs';

/**
 * Does this reel do the seven things that make a reel work?
 *
 * Advisory, never blocking, and it says so. A checklist that stops you posting
 * gets switched off within a fortnight; the press release dial works because it
 * explains at length that it is a heuristic and leaves the decision with you.
 * Same posture here.
 *
 * Each check shows the rule it came from, because a rule you can read is a rule
 * you can argue with, and some of these will turn out to be wrong for some
 * clients.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

function Mark({ pass }) {
  // Three states, not two. A check that cannot be judged yet is neither a pass
  // nor a failure, and showing it as either misreports the reel.
  const [glyph, colour, label] = pass === true ? ['✓', 'var(--positive)', 'passes']
    : pass === false ? ['·', 'var(--warning)', 'not yet']
      : ['–', 'var(--text-subtle)', 'nothing to judge yet'];
  return (
    <span aria-label={label} title={label} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: 9, flexShrink: 0, marginTop: 1,
      border: `1.5px solid ${colour}`, color: colour,
      fontSize: 12, fontWeight: 700, lineHeight: 1,
    }}>{glyph}</span>
  );
}

export default function ReelChecks({ timings = [], edit = {}, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const result = useMemo(() => checkReel({ timings, edit }), [timings, edit]);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>
          Reel checks
          <span style={{ ...CAP, marginLeft: 8 }}>
            {result.passed} of {result.total}
            {result.unknown ? `, ${result.unknown} not yet judgeable` : ''}
          </span>
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
            ...CAP, textDecoration: 'underline' }}>
          {open ? 'Hide the rules' : 'Show the rules'}
        </button>
      </div>

      <div style={{ marginTop: 'var(--s2)', display: 'grid', gap: 'var(--s2)' }}>
        {result.checks.map((c) => (
          <div key={c.key} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start' }}>
            <Mark pass={c.pass} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 'var(--fs-body)',
                color: c.pass === null ? 'var(--text-subtle)' : 'inherit' }}>{c.label}</span>
              <span style={{ ...CAP, display: 'block', lineHeight: 1.4 }}>{c.detail}</span>
              {open && (
                <span style={{ ...CAP, display: 'block', lineHeight: 1.4, fontStyle: 'italic',
                  marginTop: 2 }}>{c.rule}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* The honest limit, on screen rather than in a comment. */}
      <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)',
        borderTop: LINE, lineHeight: 1.5 }}>
        Seven of seven is not a prediction that a reel will travel. It says the reel does the
        seven things, which is all these can honestly claim. The thresholds come from October&rsquo;s
        own growth plan and are reasoned assumptions rather than measurements; they become
        findings once reach and watch time come back for thirty reels.
      </div>
    </div>
  );
}

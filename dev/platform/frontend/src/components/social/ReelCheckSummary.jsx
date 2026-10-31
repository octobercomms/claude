import React from 'react';
import { LABELS } from '@shared/reelChecks.mjs';

// What the seven checks said about this post's reel, on the post.
//
// The checks already existed, on Produce → Video and Produce → Edit, beside
// the render decision. They were not on the post card, which is where Shared
// is actually worked: you produce a reel for a post from the Produce step and
// then never see what the checks made of it. "I can't find it" is a fair
// description of that.
//
// This shows the **recorded** judgement rather than recomputing one. The
// judgement that counts was taken at render time, in socialCaptionRender,
// where the transcript, the template and the duration were all in hand. The
// browser has none of those for a finished reel, so re-judging here would
// produce a second, worse answer that disagrees with the one the learning
// curve in ReelChecks is built on.
//
// Advisory, never blocking, and it says so — same posture as the full panel. A
// checklist that stops you posting gets switched off within a fortnight.
export default function ReelCheckSummary({ result, onOpenFull = null }) {
  if (!result) return null;

  const checks = Array.isArray(result.checks) ? result.checks : [];
  if (!checks.length) return null;

  const failed = checks.filter(c => c.pass === false);
  const unknown = checks.filter(c => c.pass === null || c.pass === undefined);
  const passed = Number(result.passed) || checks.filter(c => c.pass === true).length;
  const total = Number(result.total) || checks.length;

  // Tone from what failed, not from a ratio. Six of seven with the hook
  // missed is not a good reel, and a percentage would say it was.
  const tone = failed.length === 0 ? 'var(--positive)'
    : failed.length <= 2 ? 'var(--warning)'
      : 'var(--negative)';

  return (
    <div style={{
      marginTop: 'var(--s3)', padding: 'var(--s3)',
      background: 'var(--surface-raised)',
      border: 'var(--border-w) solid var(--card-border)',
      borderRadius: 'var(--r-sm)',
    }}>
      <div className="row between center wrap" style={{ gap: 'var(--s2)' }}>
        <span className="caption">Reel checks</span>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: tone }}>
          {passed} of {total} pass
        </span>
      </div>

      {failed.length > 0 && (
        <ul style={{ margin: 'var(--s2) 0 0', paddingLeft: 'var(--s4)' }}>
          {failed.map(c => (
            <li key={c.key} className="body-xs" style={{ lineHeight: 1.5 }}>
              {LABELS[c.key] || c.key}
            </li>
          ))}
        </ul>
      )}

      {/* Unjudged is not failed, and saying which is the difference between a
          panel people read and a panel people switch off. Four of the seven
          read the words, so they stay unjudged on a reel that was never
          transcribed. */}
      {unknown.length > 0 && (
        <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
          {unknown.length} not judged: {unknown.map(c => LABELS[c.key] || c.key).join(', ').toLowerCase()}.
          {' '}Those read the words, which needs a transcript.
        </div>
      )}

      <div className="row between center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
        <span className="body-xs text-subtle">
          Taken when this reel rendered. Advice, not a gate.
        </span>
        {onOpenFull && (
          <button type="button" className="btn-inline-link" style={{ fontSize: 'var(--fs-caption)' }}
            onClick={onOpenFull}>What each check means →</button>
        )}
      </div>
    </div>
  );
}

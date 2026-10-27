import React, { useEffect, useMemo, useState } from 'react';
import { checkReel } from '@shared/reelChecks.mjs';
import { api } from '../utils/api';

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
 *
 * With a clientId it also shows what each rule has been worth on that client's
 * own published reels: the median baseline multiple of the reels that passed
 * against the reels that did not, with the count in each arm. That is the
 * difference between a checklist and a model, and it is the reason the rules
 * are recorded at production time rather than only displayed.
 *
 * The evidence line never appears without its sample size, and never claims
 * cause. A rule that goes with better reels on this account may be standing in
 * for the kind of subject it tends to get made with.
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

// How a rule has fared on this client's own reels, in a sentence an account
// manager can repeat to a client without overstating it.
function Evidence({ outcome }) {
  if (!outcome) return null;
  const { strength, n_pass: np, n_fail: nf, median_pass: mp, median_fail: mf, lift } = outcome;

  // Kept short on purpose. On a young account most checks read this way at
  // once, and five identical sentences down the panel is noise an operator
  // learns to scroll past, taking the two lines that do carry a result with
  // them.
  if (strength === 'no_variation') {
    return (
      <span style={{ ...CAP, display: 'block', lineHeight: 1.4, marginTop: 2 }}>
        No comparison yet: {np ? `all ${np}` : `none of ${nf}`} measured reels passed this.
      </span>
    );
  }

  // Counts first, claim second. The number of reels is what decides how much
  // the rest of the sentence is worth, so it is never below the fold.
  const sample = `${np} passed, ${nf} did not`;
  if (strength === 'too_early' || lift === null) {
    return (
      <span style={{ ...CAP, display: 'block', lineHeight: 1.4, marginTop: 2 }}>
        {sample}. Too few either side to compare.
      </span>
    );
  }

  const direction = outcome.predicts === 'better' ? 'reached further'
    : outcome.predicts === 'worse' ? 'reached less far'
      : 'reached about the same distance';
  const colour = outcome.predicts === 'better' ? 'var(--positive)'
    : outcome.predicts === 'worse' ? 'var(--warning)' : 'var(--text-subtle)';
  return (
    <span style={{ ...CAP, display: 'block', lineHeight: 1.4, marginTop: 2 }}>
      <strong style={{ color: colour }}>
        Reels that passed this {direction}
      </strong>
      {': '}
      {mp}&times; their own baseline against {mf}&times;. {sample}.
      {strength === 'provisional' && ' Provisional.'}
    </span>
  );
}

export default function ReelChecks({ timings = [], edit = {}, defaultOpen = false,
  clientId = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const result = useMemo(() => checkReel({ timings, edit }), [timings, edit]);
  const [learned, setLearned] = useState(null);

  // One request, on open, and a failure is silent: the checks are the point and
  // they work without this. A panel that shows an error because the evidence
  // layer could not load would make the rules look broken when they are not.
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    api.get(`/clients/${clientId}/reel-outcomes`)
      .then((r) => { if (live) setLearned(r); })
      .catch(() => {});
    return () => { live = false; };
  }, [clientId]);

  const outcomeFor = (key) => (learned?.checks || []).find((c) => c.key === key) || null;

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
              <Evidence outcome={outcomeFor(c.key)} />
              {open && (
                <span style={{ ...CAP, display: 'block', lineHeight: 1.4, fontStyle: 'italic',
                  marginTop: 2 }}>{c.rule}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* The honest limit, on screen rather than in a comment. It used to
          promise that these become findings at thirty reels; now it says where
          this client actually is, because a standing promise nobody can check
          is worse than a number. */}
      <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)',
        borderTop: LINE, lineHeight: 1.5 }}>
        Seven of seven is not a prediction that a reel will travel. It says the reel does the
        seven things, which is all these can honestly claim. The thresholds come from October&rsquo;s
        own growth plan.
        {learned ? (
          <>
            {' '}
            {learned.reels
              ? <>On this client, {learned.reels} published reel{learned.reels === 1 ? '' : 's'} can
                be measured against {learned.published_posts} posts, and the lines above are what
                those reels did. {learned.caveat}</>
              : <>No reel on this client can be measured yet: {learned.judged} judged,
                {' '}{learned.excluded.awaiting_numbers} waiting on numbers,
                {' '}{learned.excluded.no_baseline} without enough comparable posts to hold
                them against.</>}
            {learned.excluded.stale_rules > 0 && (
              <> {learned.excluded.stale_rules} earlier reel
                {learned.excluded.stale_rules === 1 ? ' is' : 's are'} left out, having been
                judged under rules that have since changed.</>
            )}
          </>
        ) : (
          <> They are reasoned assumptions rather than measurements until enough reels have
            been published to test them.</>
        )}
      </div>
    </div>
  );
}

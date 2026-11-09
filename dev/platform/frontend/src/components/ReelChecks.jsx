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
  clientId = null,
  // Reports the verdict upward, so the one line that answers "is this any
  // good" can also be drawn where it is never in a scroll — the top bar.
  // The alternative was for the bar to call `checkReel` itself, which would
  // be a second implementation of the verdict that quietly disagrees with
  // this one the first time either side changes: this panel merges the
  // client's tracked terms into the edit before judging, and a bar that did
  // not would show a different count from the list underneath it.
  onResult = null }) {
  // VERDICT FIRST. `open` means "show the reasoning", for every check at
  // once; `expanded` is the one check somebody asked about.
  //
  // This panel was 1246px tall in a 260px column with its reasoning always
  // on, and its own heading landed 674px into a 524px scroller: the one
  // thing on the screen that answers "is this any good" was below the fold
  // on a screen whose whole job is to answer that. Ten verdicts are about
  // 220px. The reasoning has not gone anywhere; it costs one click, and the
  // measured cost of showing it to everybody forever was the panel itself.
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [learned, setLearned] = useState(null);
  const [keywords, setKeywords] = useState([]);

  // The tracked terms join the edit rather than being checked separately, so
  // the browser and the server judge a reel against exactly the same input.
  // Declared after the state it reads: a const in a closure above its own
  // useState throws at render, which neither the linter nor a build notices.
  const result = useMemo(
    () => checkReel({ timings, edit: { ...edit, keywords } }),
    [timings, edit, keywords]);

  // One request, on open, and a failure is silent: the checks are the point and
  // they work without this. A panel that shows an error because the evidence
  // layer could not load would make the rules look broken when they are not.
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    api.get(`/clients/${clientId}/reel-outcomes`)
      .then((r) => { if (live) setLearned(r); })
      .catch(() => {});
    api.get(`/clients/${clientId}/reel-keywords`)
      .then((r) => { if (live) setKeywords(r.keywords || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [clientId]);

  // `result` is a useMemo, so this fires when the verdict changes rather
  // than on every render.
  useEffect(() => {
    if (!onResult) return;
    const worst = result.checks.some((c) => c.pass === false) ? 'fail'
      : result.checks.some((c) => c.pass === null) ? 'unknown' : 'pass';
    onResult({ passed: result.passed, total: result.total, unknown: result.unknown, worst });
  }, [result, onResult]);

  const outcomeFor = (key) => (learned?.checks || []).find((c) => c.key === key) || null;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap',
        paddingBottom: 'var(--s1)', borderBottom: LINE, marginBottom: 'var(--s2)' }}>
        {/* The same register as the inspector's other group headings —
            uppercase caption weight — because this IS one of its groups and
            was drawing itself as a card title inside a panel of labels.
            The count stays on the heading: it is the one line that answers
            the operator's question, and it is why the heading is worth
            reaching. */}
        <span style={{
          fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: 'var(--text-subtle)',
        }}>
          Reel checks
          <span style={{ marginLeft: 8, letterSpacing: 0 }}>
            {result.passed} of {result.total}
            {result.unknown ? `, ${result.unknown} not yet judgeable` : ''}
          </span>
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
            ...CAP, textDecoration: 'underline' }}>
          {open ? 'Hide the reasoning' : 'Show the reasoning'}
        </button>
      </div>

      <div style={{ marginTop: 'var(--s2)', display: 'grid', gap: 'var(--s1)' }}>
        {result.checks.map((c) => {
          const showing = open || expanded.has(c.key);
          return (
            // A BUTTON, not a div with a click on it. Every row here is a
            // question somebody can ask, so each one has to be reachable by
            // keyboard and has to say whether it is open.
            <button key={c.key} type="button" onClick={() => toggle(c.key)}
              aria-expanded={showing} data-check={c.key}
              style={{ background: 'none', border: 0, padding: '2px 0', margin: 0,
                textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
                display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', width: '100%' }}>
              <Mark pass={c.pass} />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 'var(--fs-body)', lineHeight: 1.35,
                  color: c.pass === null ? 'var(--text-subtle)' : 'inherit' }}>{c.label}</span>
                {showing && (
                  <>
                    <span style={{ ...CAP, display: 'block', lineHeight: 1.4 }}>{c.detail}</span>
                    <Evidence outcome={outcomeFor(c.key)} />
                    <span style={{ ...CAP, display: 'block', lineHeight: 1.4, fontStyle: 'italic',
                      marginTop: 2 }}>{c.rule}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* The honest limit, on screen rather than in a comment. It used to
          promise that these become findings at thirty reels; now it says where
          this client actually is, because a standing promise nobody can check
          is worse than a number. */}
      {/* The honest limit. One line always, the whole of it with the
          reasoning: eight lines of prose at 224px of measure was a third of
          this panel, repeating a caveat the reader has already taken in. */}
      <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)',
        borderTop: LINE, lineHeight: 1.5 }}>
        Advisory. {result.total} of {result.total} is not a prediction that a reel will travel.
        {open && <>
        {' '}It says the
        reel does the {result.total} things, which is all these can honestly claim. The thresholds
        come from October&rsquo;s own growth plan.
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
        </>}
      </div>
    </div>
  );
}

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';

// What a button is about to spend, next to the button.
//
// The Costs screen answers "where did the bill go", which is the right
// question once a month. This answers "what is this click worth", which is
// the question you have at the moment you can still decide not to click. One
// fetch for the whole app, shared through context, because otherwise every
// button on a page would ask the same question separately.
//
// The number is a MEDIAN of the last 30 days, not a mean: one 4K upscale
// drags a mean far above what the next click costs, and an estimate that
// overstates by 10x gets ignored, which is worse than showing nothing.

const Ctx = createContext({ features: {}, tasks: [], ready: false });

export function FeatureCostProvider({ children }) {
  const [state, setState] = useState({ features: {}, tasks: [], ready: false });
  // This provider wraps the router, so it mounts on the login screen, on a
  // client's share link and on every other page reachable without a session.
  // The endpoint behind it is admin-only. Asking anyway answered 401, and the
  // api layer's 401 branch sent the browser to /login — which remounted this
  // provider, which asked again: the login screen reloaded about sixteen
  // times a second and read as a flicker. So it does not ask until there is
  // somebody to ask for.
  const { isAuthenticated, loading } = useAuth();
  useEffect(() => {
    if (loading || !isAuthenticated) return undefined;
    let live = true;
    // Two reads, one settle. The task budgets are what let a chip say how
    // much of this month's allowance is left, which is the number that stops
    // a batch run surprising somebody. Budgets are opt-in, so an empty list
    // is the ordinary case and not an error.
    Promise.all([
      api.get('/settings/usage/feature-costs').catch(() => ({})),
      api.get('/settings/usage/task-budgets').catch(() => ({})),
    ])
      // Silent: a missing cost figure must never be louder than the feature
      // it annotates, and this is an admin convenience, not a dependency.
      .then(([costs, budgets]) => {
        if (!live) return;
        setState({
          features: costs.features || {},
          tasks: Array.isArray(budgets.tasks) ? budgets.tasks : [],
          ready: true,
        });
      })
      .catch(() => { if (live) setState({ features: {}, tasks: [], ready: true }); });
    return () => { live = false; };
  }, [isAuthenticated, loading]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useFeatureCost(feature) {
  const { features, ready } = useContext(Ctx);
  return { ...(features[feature] || null), ready, known: !!features[feature] };
}

/** This month's allowance for a named task, or null when none is set. */
export function useTaskBudget(task) {
  const { tasks, ready } = useContext(Ctx);
  if (!task) return { ready, known: false };
  const row = (tasks || []).find(t => t.task === task);
  if (!row || row.monthly_cap_usd == null) return { ready, known: false };
  return {
    ready,
    known: true,
    cap: row.monthly_cap_usd,
    spent: row.spent_usd,
    remaining: row.remaining_usd,
    blocked: row.blocked,
    label: row.label,
  };
}

// Every figure here is USD, because every provider OMI buys from bills in
// USD. The `$` is therefore the correct symbol rather than a default one, and
// the tooltip says so outright: October works in USD, GBP and EUR, and the
// house rule is that a number whose currency is left to be guessed reads as a
// fact in whichever currency the reader had in mind. See utils/money.js.
function money(n) {
  if (!Number.isFinite(n)) return null;
  // Zero is not a figure, it is the absence of one. A feature that has run
  // and cost nothing measurable has nothing useful to say here, and printing
  // "$0" next to a button would make the chip's presence mean nothing — the
  // whole point of it is that a chip means this one spends.
  if (n === 0) return null;
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(n < 100 ? 2 : 0)}`;
}

/**
 * What a run is about to cost, and whether the month can afford it.
 *
 * Pulled out of the component so it can be tested. The repo has paid for
 * this lesson before: a decision written inline where exercising it needs a
 * mounted page and a live endpoint is a decision a mutation can delete
 * without any test noticing (see `queueFor` in the strategist).
 *
 * `units` of null means a single run, so there is no total to compute and the
 * chip shows a per-run price. `remaining` of null means no budget is set,
 * which is the ordinary case because budgets are opt-in, and it can never
 * make a run read as unaffordable.
 */
export function summarise({ perCall, units, remaining }) {
  const n = Number.isFinite(units) && units > 0 ? Math.round(units) : null;
  const batchTotal = n != null && Number.isFinite(perCall) ? perCall * n : null;
  // Colour only where it carries information: this run costs more than the
  // month has left. A permanently coloured chip is decoration, and a chip
  // that cries wolf is one people stop reading.
  const over = batchTotal != null && Number.isFinite(remaining) && batchTotal > remaining;
  return { n, batchTotal, over };
}

/**
 * Inline cost hint. Renders nothing at all when the feature has no history —
 * a blank where a number should be is worse than no slot, and a new feature
 * has no median to show.
 *
 *   <FeatureCost feature="visualise_scenario" />        → ~$0.04 a run
 *   <FeatureCost feature="image_gen" spent />           → ~$0.04 a run · $3.20 in 30d
 *   <FeatureCost feature="x" units={30} />              → ~$0.28 each · 30 × ≈ $8.40
 *   <FeatureCost feature="x" units={30} task="video_batch" />
 *                        → ~$0.28 each · 30 × ≈ $8.40 · $41 left this month
 *
 * `units` is what turns this from a price list into something you can decide
 * on: the question at the moment you can still not click is what THIS click
 * costs, and for a batch that is the unit price times the number of items.
 *
 * ONE CHIP PER CARD, not per button. Transcribe, captions, b-roll, visualise
 * and a batch all spend, and five chips on one card is ambient noise that
 * destroys the only thing the chip is for: its presence meaning this one
 * costs money. Put it on the action that commits the spend.
 */
export default function FeatureCost({
  feature,
  units = null,
  unitLabel = '',
  task = null,
  spent = false,
  className = '',
}) {
  const c = useFeatureCost(feature);
  const b = useTaskBudget(task);
  if (!c.ready || !c.known || !c.calls) return null;

  const per = money(c.per_call);
  if (!per) return null;

  const { n, batchTotal, over } = summarise({
    perCall: c.per_call,
    units,
    remaining: b.known ? b.remaining : null,
  });
  const batch = batchTotal != null ? money(batchTotal) : null;
  const window = money(c.cost_usd);

  const parts = [n != null ? `~${per} each` : `~${per} a run`];
  if (batch) parts.push(`${n}${unitLabel ? ` ${unitLabel}` : ' ×'} ≈ ${batch}`);
  if (spent && window) parts.push(`${window} in 30d`);

  return (
    <span className={`feature-cost ${className}`.trim()}
      title={`Median of ${c.calls} call${c.calls === 1 ? '' : 's'} in the last 30 days, in USD,`
        + ' which is what every provider behind this bills in.'
        + (window ? ` Total ${window} over that window.` : '')
        + (b.known ? ` ${b.label} budget: ${money(b.spent) || '$0.00'} of ${money(b.cap)} used this month.` : '')
        + ' An estimate from what this feature has actually cost, not a quote.'}>
      {parts.join(' · ')}
      {b.known && b.remaining != null && (
        <>
          {' · '}
          <span className={over ? 'chip-warning' : undefined}>
            {over
              ? `over the ${money(b.remaining) || '$0'} left this month`
              : `${money(b.remaining) || '$0'} left this month`}
          </span>
        </>
      )}
    </span>
  );
}

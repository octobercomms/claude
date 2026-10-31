import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';

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

const Ctx = createContext({ features: {}, ready: false });

export function FeatureCostProvider({ children }) {
  const [state, setState] = useState({ features: {}, ready: false });
  useEffect(() => {
    let live = true;
    api.get('/settings/usage/feature-costs')
      .then(d => { if (live) setState({ features: d.features || {}, ready: true }); })
      // Silent: a missing cost figure must never be louder than the feature
      // it annotates, and this is an admin convenience, not a dependency.
      .catch(() => { if (live) setState({ features: {}, ready: true }); });
    return () => { live = false; };
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useFeatureCost(feature) {
  const { features, ready } = useContext(Ctx);
  return { ...(features[feature] || null), ready, known: !!features[feature] };
}

function money(n) {
  if (!Number.isFinite(n)) return null;
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(n < 100 ? 2 : 0)}`;
}

/**
 * Inline cost hint. Renders nothing at all when the feature has no history —
 * a blank where a number should be is worse than no slot, and a new feature
 * has no median to show.
 *
 *   <FeatureCost feature="visualise_scenario" />   → ~$0.04 a run
 *   <FeatureCost feature="image_gen" spent />      → ~$0.04 a run · $3.20 in 30d
 */
export default function FeatureCost({ feature, spent = false, className = '' }) {
  const c = useFeatureCost(feature);
  if (!c.ready || !c.known || !c.calls) return null;

  const per = money(c.per_call);
  const total = money(c.cost_usd);
  if (!per) return null;

  return (
    <span className={`feature-cost ${className}`.trim()}
      title={`Median of ${c.calls} call${c.calls === 1 ? '' : 's'} in the last 30 days.`
        + ` Total ${total} over that window.`
        + ' An estimate from what this feature has actually cost, not a quote.'}>
      ~{per} a run{spent && total ? ` · ${total} in 30d` : ''}
    </span>
  );
}

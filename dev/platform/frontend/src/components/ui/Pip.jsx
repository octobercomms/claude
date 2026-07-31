// Pip — the function-colour wayfinding dot. The SAME function wears the SAME
// colour everywhere in OMI, so things that share a job (Create, Measure,
// Research…) read as belonging together across every suite. Muted, label-only —
// never a button fill or a surface; accent yellow stays reserved for the action.
//
//   <Pip fn="create" /> Make a piece of content
//
// `label` renders the function name after the dot as an uppercase kicker.
import React from 'react';

export const FUNCTIONS = {
  research: 'Research',
  strategy: 'Strategy',
  create: 'Create',
  distribute: 'Distribute',
  measure: 'Measure',
  data: 'Data & setup',
  approve: 'Approve',
};

export default function Pip({ fn = 'measure', label = false, title }) {
  const name = FUNCTIONS[fn] || fn;
  const dot = <span className={`pip-fn pip-${fn}`} title={title || (label ? undefined : name)} aria-hidden="true" />;
  if (!label) return dot;
  // Kicker: dot + function word set in the function's own colour.
  return <span className={`fn-kicker fn-${fn}`}>{dot}{typeof label === 'string' ? label : name}</span>;
}

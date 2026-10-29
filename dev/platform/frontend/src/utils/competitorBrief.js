// Turn a competitor-ads run into the opening text of a brief.
//
// Competitors used to be a dead end: you read a rival's angles, then retyped
// what you had learned into the brief form by hand, which is the step everyone
// skips. Research that cannot reach the brief is filing, not research.
//
// A plain module rather than a closure inside the panel, so the shape of what
// gets handed over can be tested — an empty analysis must not produce a brief
// that looks full, and a run with nothing in it must not seed at all.
export function briefSeedFor(run) {
  if (!run) return '';
  const a = run.analysis || {};
  const section = (title, items) => {
    const clean = (items || []).filter(i => typeof i === 'string' && i.trim());
    if (!clean.length) return [];
    return ['', `${title}:`, ...clean.map(i => `- ${i}`)];
  };

  const body = [
    ...(a.overview ? ['', a.overview] : []),
    ...section('Angles they are testing', a.angles),
    ...section('Longest-running, so probably their winners', a.longest_running),
    ...section('Counter-ad ideas', a.counter_ideas),
  ];

  // Nothing was found, so there is nothing to write from. Returning a header
  // and an instruction would hand the account lead a brief that reads as
  // research when the pull came back empty.
  if (!body.length) return '';

  return [
    `Competitor research — ${run.query} (${run.region}), ${run.ad_count} live ads.`,
    ...body,
    '',
    'Write concepts that take a different position from the above rather than matching it.',
  ].join('\n');
}

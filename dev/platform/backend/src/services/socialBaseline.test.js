// Guard — a winner is a post that beat its own account, not a post with a
// flattering fraction.
//
// The old ranking divided interactions by reach, so the smallest posts won.
// These checks pin the replacement: a per-cohort leave-one-out median, a
// stated fallback when the cohort is thin, a reach floor under the rate, and a
// sort order that puts the measured posts in the right places.

const b = require('./socialBaseline');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// A post shaped as getRecentWinners' SQL returns one.
const post = (id, platform, kind, reach, interactions) => ({
  id, platform, kind, reach, likes: interactions, comments: 0, shares: 0, saves: 0,
});

// --- the failure that started this -----------------------------------------
// Five reels so the cohort is measurable. One tiny post with a huge ratio, one
// genuine hit. The tiny one used to rank first.
{
  const posts = [
    post('tiny', 'instagram', 'reel', 10, 3),        // 30% engagement, 0.03× baseline
    post('hit', 'instagram', 'reel', 40000, 900),    // 2.25% engagement, ~10× baseline
    post('a', 'instagram', 'reel', 4000, 80),
    post('c', 'instagram', 'reel', 3500, 70),
    post('d', 'instagram', 'reel', 4500, 90),
  ];
  const ranked = b.rank(posts);
  check('the genuine hit ranks first, not the 10-reach post',
    ranked[0].id === 'hit', `first was ${ranked[0].id} at ${ranked[0].reach_multiple}×`);
  check('the 10-reach post ranks last', ranked[ranked.length - 1].id === 'tiny');

  const hit = ranked.find(p => p.id === 'hit');
  check('the hit is scored as a multiple of its own baseline',
    hit.reach_multiple > 8 && hit.reach_multiple < 12, `${hit.reach_multiple}×`);
  check('the hit is flagged a heater', hit.is_heater === true);

  const tiny = ranked.find(p => p.id === 'tiny');
  check('a rate off 10 reach is withheld rather than printed',
    tiny.engagement_rate === null, `got ${tiny.engagement_rate}`);
  check('withholding it says why', /denominator/.test(tiny.baseline_note || ''),
    tiny.baseline_note);
  check('a rate above the floor is still given',
    hit.engagement_rate !== null && hit.engagement_rate > 2 && hit.engagement_rate < 2.5,
    `${hit.engagement_rate}`);
}

// --- leave-one-out ---------------------------------------------------------
// A single viral post must not raise the bar it is judged against.
{
  const posts = [
    post('viral', 'instagram', 'reel', 100000, 1000),
    post('a', 'instagram', 'reel', 1000, 20),
    post('c', 'instagram', 'reel', 1000, 20),
    post('d', 'instagram', 'reel', 1000, 20),
    post('e', 'instagram', 'reel', 1000, 20),
  ];
  const viral = b.rank(posts).find(p => p.id === 'viral');
  check('a viral post is measured against the others, not itself',
    viral.reach_multiple === 100, `${viral.reach_multiple}× (baseline ${viral.reach_baseline})`);
  check('its baseline excludes it', viral.reach_baseline === 1000 && viral.baseline_n === 4,
    `baseline ${viral.reach_baseline} from ${viral.baseline_n}`);
}

// --- cohorts ---------------------------------------------------------------
// Reels out-reach text posts everywhere. Pooling them made every reel a heater
// and no LinkedIn post ever one.
{
  const posts = [
    ...[1, 2, 3, 4, 5].map(i => post(`r${i}`, 'instagram', 'reel', 10000, 200)),
    ...[1, 2, 3, 4].map(i => post(`l${i}`, 'linkedin', 'text', 500, 25)),
    post('l-hit', 'linkedin', 'text', 2500, 120),
  ];
  const ranked = b.rank(posts);
  const liHit = ranked.find(p => p.id === 'l-hit');
  const reel = ranked.find(p => p.id === 'r1');
  check('a strong LinkedIn post is measured against LinkedIn',
    liHit.baseline_scope === 'cohort' && liHit.reach_multiple === 5,
    `${liHit.baseline_scope} ${liHit.reach_multiple}×`);
  check('it is a heater despite reaching a twentieth of a reel', liHit.is_heater === true);
  check('an average reel is not a heater just for being a reel',
    reel.is_heater === false, `${reel.reach_multiple}×`);
  check('the LinkedIn post outranks the average reels', ranked[0].id === 'l-hit',
    `first was ${ranked[0].id}`);
  check('cohorts are keyed on platform and format',
    reel.cohort === 'instagram|reel' && liHit.cohort === 'linkedin|text');
}

// --- thin data -------------------------------------------------------------
{
  const two = b.score([
    post('a', 'instagram', 'reel', 5000, 100),
    post('x', 'instagram', 'reel', 1000, 20),
  ]);
  check('under five posts there is no multiple at all',
    two.every(p => p.reach_multiple === null && p.baseline_scope === 'none'),
    JSON.stringify(two.map(p => [p.id, p.baseline_scope, p.reach_multiple])));
  check('and it says how many more are needed',
    /3 more published posts/.test(two[0].baseline_note || ''), two[0].baseline_note);
  check('nothing is a heater without a baseline', two.every(p => p.is_heater === false));

  // Enough posts on the account, not enough of this kind: the comparison
  // widens and has to admit it.
  // Five reels, so that cohort stands on its own, and one lone carousel, which
  // cannot. Four reels would have been a thin cohort too, and both would fall
  // back — which is correct, and not what this check is about.
  const mixed = b.score([
    ...[1, 2, 3, 4, 5].map(i => post(`r${i}`, 'instagram', 'reel', 1000, 20)),
    post('solo', 'instagram', 'carousel', 3000, 60),
  ]);
  const solo = mixed.find(p => p.id === 'solo');
  check('a thin cohort falls back to the whole account',
    solo.baseline_scope === 'account' && solo.reach_multiple === 3,
    `${solo.baseline_scope} ${solo.reach_multiple}×`);
  check('the fallback is stated, not silent',
    /whole account/.test(solo.baseline_note || ''), solo.baseline_note);
  check('a full cohort is not labelled a fallback',
    mixed.find(p => p.id === 'r1').baseline_scope === 'cohort');
}

// --- the median itself -----------------------------------------------------
{
  check('an even count takes the mean of the middle two', b.median([1, 2, 3, 4]) === 2.5,
    `${b.median([1, 2, 3, 4])}`);
  check('an odd count takes the middle', b.median([5, 1, 3]) === 3);
  check('an empty set is zero, not NaN', b.median([]) === 0);
  check('the median ignores a non-numeric entry', b.median([1, null, 3, undefined]) === 2);
}

// --- platform metric differences -------------------------------------------
// Instagram reports reach, LinkedIn impressions, TikTok views. All three are
// read, and only ever compared inside one cohort.
{
  const posts = [
    ...[1, 2, 3, 4].map(i => ({ id: `t${i}`, platform: 'tiktok', kind: 'reel', views: 2000, likes: 40 })),
    { id: 'tv', platform: 'tiktok', kind: 'reel', views: 8000, likes: 300 },
  ];
  const tv = b.rank(posts).find(p => p.id === 'tv');
  check('views stand in for reach where that is what the platform gives',
    tv.reach_like === 8000 && tv.reach_multiple === 4, `${tv.reach_like} ${tv.reach_multiple}×`);
}
{
  const posts = [
    ...[1, 2, 3, 4].map(i => ({ id: `i${i}`, platform: 'linkedin', kind: 'text', impressions: 1000, likes: 10 })),
    { id: 'iv', platform: 'linkedin', kind: 'text', impressions: 3000, likes: 60 },
  ];
  const iv = b.rank(posts).find(p => p.id === 'iv');
  check('impressions stand in where that is what the platform gives',
    iv.reach_like === 3000 && iv.reach_multiple === 3);
}

// --- interactions as a separate signal -------------------------------------
// Two posts that travelled equally far, separated by what people did.
{
  const posts = [
    ...[1, 2, 3].map(i => post(`a${i}`, 'instagram', 'reel', 2000, 40)),
    post('seen', 'instagram', 'reel', 8000, 40),
    post('acted', 'instagram', 'reel', 8000, 600),
  ];
  const ranked = b.rank(posts);
  const seen = ranked.find(p => p.id === 'seen');
  const acted = ranked.find(p => p.id === 'acted');
  check('reach multiples are equal when reach is equal',
    seen.reach_multiple === acted.reach_multiple, `${seen.reach_multiple} vs ${acted.reach_multiple}`);
  check('the interaction multiple separates them',
    acted.interaction_multiple > seen.interaction_multiple,
    `${acted.interaction_multiple} vs ${seen.interaction_multiple}`);
  check('and the one people acted on ranks higher',
    ranked.indexOf(acted) < ranked.indexOf(seen));
}

// --- no reach recorded -----------------------------------------------------
{
  const posts = [1, 2, 3, 4, 5].map(i => post(`z${i}`, 'instagram', 'reel', 0, 0));
  const scored = b.score(posts);
  check('posts with no reach yield no multiple and no crash',
    scored.every(p => p.reach_multiple === null && p.engagement_rate === null));
  check('a zero baseline is reported as missing, not as a divide',
    scored.every(p => p.reach_baseline === null
      && Number.isFinite(p.rank_score)));
}

// --- the empty case --------------------------------------------------------
{
  check('an account with nothing published returns nothing', b.rank([]).length === 0);
  check('the explanation names the threshold and the heater bar',
    /2×/.test(b.explain()) && new RegExp(String(b.MIN_COMPARABLE)).test(b.explain()),
    b.explain());
}

// --- the callers agree on the unit -----------------------------------------
// engagement_rate is percentage points. The overview report used to store it
// and then multiply by 100 again in the client-facing summary prompt.
{
  const fs = require('fs');
  const path = require('path');
  const report = fs.readFileSync(path.join(__dirname, 'socialOverviewReport.js'), 'utf8');
  check('the summary prompt does not re-multiply the percentage',
    !/avg_engagement_rate \|\| 0\) \* 100/.test(report),
    'a 2.3% account would be described to the client as 230%');
  check('a null rate is excluded from the average rather than counted as zero',
    /r !== null && r !== undefined/.test(report));

  const social = fs.readFileSync(path.join(__dirname, 'social.js'), 'utf8');
  check('the generation prompt grounds on the multiple',
    /its own \$\{w\.baseline_scope/.test(social) || /baseline_scope === 'cohort'/.test(social),
    'the batch would still be modelled on whatever had the best fraction');
  check('the generation prompt cannot interpolate a null rate',
    /w\.engagement_rate !== null/.test(social));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

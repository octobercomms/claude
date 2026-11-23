// A completed form has to tell the ad platforms what happened.
//
// Until 1.4 the plugin fired nothing at all. Every event reaching Google and
// Meta came from the nvelope.co child theme, keyed off a `?step=` parameter,
// so the strongest signal either platform had was `sbm_landing`: somebody
// arrived on the page. A campaign optimised against that buys the cheapest
// people who will land, which is the opposite of qualifying a buyer.
//
// Three things here fail silently if they regress, which is why they are
// pinned rather than left to review:
//
//   The Lead event must stay gated on is_conversion. Firing it on every
//   completion puts the ad platforms straight back to buying volume, and the
//   reporting would say results improved.
//
//   trackCompletion has to run BEFORE the redirect. An ending with a
//   redirect_url navigates away, and anything after it never executes.
//
//   Both completion paths have to call it. The AI chat route finishes
//   submissions too, and a conversion that fires on one path of two teaches
//   the platform from half the data with nothing on screen to say so.
//
//   node tests/tracking.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../assets/js/frontend.js'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

// Pull the shipped function out and run it, so these assertions are against
// the code that ships rather than a copy that can drift.
function loadTrackCompletion() {
  const start = SRC.indexOf('function trackCompletion(cfg, ending) {');
  assert.ok(start > 0, 'trackCompletion is gone from frontend.js');
  // Walk to the matching close brace.
  let depth = 0, i = SRC.indexOf('{', start);
  const from = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = SRC.slice(start, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function('window', `${body}; return trackCompletion;`);
}

const makeTracker = loadTrackCompletion();

// A window with every pixel present, recording what it was told.
function spyWindow() {
  const calls = { gtag: [], fbq: [], twq: [], pintrk: [], dataLayer: [] };
  const w = {
    gtag: (...a) => calls.gtag.push(a),
    fbq: (...a) => calls.fbq.push(a),
    twq: (...a) => calls.twq.push(a),
    pintrk: (...a) => calls.pintrk.push(a),
  };
  w.dataLayer = calls.dataLayer;
  return { w, calls };
}

const CFG = { formId: 1945 };

ok('a qualified ending reports the outcome and a Lead', () => {
  const { w, calls } = spyWindow();
  makeTracker(w)(CFG, { outcome: 'qualified', is_conversion: true });

  assert.ok(calls.gtag.some(c => c[0] === 'event' && c[1] === 'sbm_qualified'),
    `no sbm_qualified event went to Google; got ${JSON.stringify(calls.gtag)}`);
  assert.ok(calls.fbq.some(c => c[0] === 'trackCustom' && c[1] === 'sbm_qualified'),
    'no sbm_qualified event went to Meta');
  assert.ok(calls.fbq.some(c => c[0] === 'track' && c[1] === 'Lead'),
    'the standard Lead event did not fire for a qualified enquiry, so no campaign can optimise towards it');
  assert.ok(calls.gtag.some(c => c[1] === 'generate_lead'),
    'generate_lead did not fire for a qualified enquiry');
});

ok('an out-of-scope ending reports the outcome but NOT a Lead', () => {
  const { w, calls } = spyWindow();
  makeTracker(w)(CFG, { outcome: 'out_of_scope', is_conversion: false });

  assert.ok(calls.fbq.some(c => c[0] === 'trackCustom' && c[1] === 'sbm_out_of_scope'),
    'the outcome was not reported at all, so the funnel is invisible');
  assert.ok(!calls.fbq.some(c => c[0] === 'track' && c[1] === 'Lead'),
    'an out-of-scope enquiry fired the Lead event; Meta would optimise towards finding more of them, '
    + 'and the reporting would call that an improvement');
  assert.ok(!calls.gtag.some(c => c[1] === 'generate_lead'),
    'an out-of-scope enquiry fired generate_lead');
});

ok('a missing pixel is the normal case, not an error', () => {
  // Pixels are injected per studio by the theme and most clients have some
  // fields blank, so most pages have only one or two of these globals.
  assert.doesNotThrow(() => makeTracker({})(CFG, { outcome: 'qualified', is_conversion: true }),
    'a page with no pixels at all threw, which would stop the visitor seeing their ending');

  const partial = { fbq: () => {} };
  assert.doesNotThrow(() => makeTracker(partial)(CFG, { outcome: 'lead', is_conversion: false }),
    'a page with only the Meta pixel threw');
});

ok('a pixel that throws does not take the ending down with it', () => {
  const w = {
    gtag: () => { throw new Error('blocked by an extension'); },
    fbq: (...a) => { w._fbq = (w._fbq || []).concat([a]); },
  };
  assert.doesNotThrow(() => makeTracker(w)(CFG, { outcome: 'qualified', is_conversion: true }),
    'one failing pixel stopped the whole function');
  assert.ok((w._fbq || []).length > 0,
    'a throw in the first pixel stopped the later ones reporting');
});

ok('the outcome is reduced to something usable as an event name', () => {
  const { w, calls } = spyWindow();
  makeTracker(w)(CFG, { outcome: 'Out of scope!! <script>', is_conversion: false });
  const names = calls.fbq.map(c => c[1]).concat(calls.gtag.map(c => c[1]));
  assert.ok(names.every(n => /^[a-z0-9_]+$/i.test(String(n))),
    `an event name carried characters a platform will reject: ${JSON.stringify(names)}`);
});

ok('an ending with no outcome still reports', () => {
  const { w, calls } = spyWindow();
  makeTracker(w)(CFG, {});
  assert.ok(calls.fbq.some(c => c[1] === 'sbm_lead'),
    'an ending with no outcome set reported nothing at all');
});

ok('a tag manager can pick it up without the plugin knowing', () => {
  const { w, calls } = spyWindow();
  makeTracker(w)(CFG, { outcome: 'qualified', is_conversion: true });
  const pushed = calls.dataLayer[0];
  assert.ok(pushed, 'nothing was pushed to the dataLayer');
  assert.strictEqual(pushed.event, 'sbm_qualified');
  assert.strictEqual(pushed.ocf_is_conversion, true);
  assert.strictEqual(pushed.ocf_form_id, 1945, 'the form id did not travel, so events cannot be told apart per client');
});

// ── the two things that are about placement, not behaviour ──────────────────

ok('tracking fires before the redirect, in BOTH paths', () => {
  // An ending with a redirect_url navigates away. Anything after that line
  // never runs, so the order here is the difference between a conversion
  // being recorded and not.
  //
  // Checked per path, not across the file. A first version of this compared
  // the standard path's call against the AI path's redirect hundreds of lines
  // below, so it passed happily with the standard path's order reversed.
  const split = SRC.indexOf('function AIChat');
  assert.ok(split > 0, 'AIChat is gone from frontend.js');

  for (const [name, region] of [['standard form', SRC.slice(0, split)], ['AI chat', SRC.slice(split)]]) {
    const track = region.indexOf('trackCompletion(cfg, ending);');
    const redirect = region.indexOf('window.location.href = ending.redirect_url;');
    assert.ok(track > 0, `the ${name} path no longer calls trackCompletion`);
    assert.ok(redirect > 0, `the ${name} path no longer redirects, so this guard is checking nothing`);
    assert.ok(track < redirect,
      `in the ${name} path the redirect happens before tracking fires, so any ending with a `
      + 'redirect_url records no conversion at all');
  }
});

ok('both completion paths report', () => {
  const calls = SRC.split('trackCompletion(cfg, ending);').length - 1;
  assert.strictEqual(calls, 2,
    `trackCompletion is called ${calls} time(s); the standard form and the AI chat both complete `
    + 'submissions, and a conversion firing on one path of two teaches the platform from half the data');

  const aiAt = SRC.indexOf('function AIChat');
  assert.ok(aiAt > 0, 'AIChat is gone from frontend.js');
  assert.ok(SRC.indexOf('trackCompletion(cfg, ending);', aiAt) > aiAt,
    'the AI chat path completes submissions without reporting any of them');
});

console.log(`\n${passed} passed, 0 failed`);

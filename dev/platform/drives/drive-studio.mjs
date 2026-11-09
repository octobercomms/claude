import pw from './pw.mjs';

// Produce becomes Make / Batch / Media, and the video editor is called Studio.
//
// Unit guards already pin the slug resolution and the search keyword. What
// they cannot see is whether the panel actually renders the three groups,
// whether the renamed row lights up, and whether the address anyone had open
// before the rename still lands on the editor rather than on the section
// default. The last one is the dangerous case: a retired slug that falls
// through to the default opens a working page showing the wrong screen, and
// nothing fails.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const open = async (path) => {
  const p = await b.newPage();
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${path}: ${e.message}`);
  });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── 1. The three groups, and the row names ───────────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  const t = await text(p);
  // Headings render uppercase; compare case-insensitively. Three drives in
  // this project have been lost to that.
  for (const h of ['MAKE', 'BATCH', 'MEDIA']) {
    say(new RegExp(`\\b${h}\\b`, 'i').test(t), `the panel has a ${h} group`);
  }
  say(/\bStudio\b/.test(t), 'the editor row is called Studio');
  say(!/\bVideo\b/.test(t.slice(0, 1200)),
    'and no row still reads Video', t.slice(0, 1200).match(/Video/) ? 'found Video' : '');
  await p.close();
}

// ── 1b. Visualise is in the nav at all ──────────────────────────────────
//
// It was not. The panel, the phone picker and the search box each read
// canVisualise as the per-user `can_use_visualise` grant, while the page reads
// it as `!readOnly || grant`, because the grant is there to let a CLIENT in
// and an agency login was always allowed. The grant is only ever set on client
// accounts, so the row appeared for nobody while the page worked if you typed
// the URL. The stub user is role 'admin' with no grant, which is exactly the
// case that was broken: before the fix this assertion fails.
{
  const p = await open('/clients/c1/produce/studio');
  const t = await text(p);
  say(/\bVisualise\b/.test(t), 'an agency login sees the Visualise row',
    /\bVisualise\b/.test(t) ? '' : 'the row is hidden from a user with no can_use_visualise grant');
  await p.close();
}

// ── 2. The renamed row lights up on its own URL ──────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '');
  say(/Studio/i.test(active), 'Studio is the active row on /produce/studio',
    `active row read "${active}"`);
  await p.close();
}

// ── 3. The retired URL still opens the editor ────────────────────────────
//
// Not "the page loads" — a page loads either way. What is checked is that it
// is the SAME screen, by comparing what the two addresses render.
{
  const a = await open('/clients/c1/produce/studio');
  const c = await open('/clients/c1/produce/compose');
  const ta = (await text(a)).slice(0, 600);
  const tc = (await text(c)).slice(0, 600);
  say(ta === tc, '/produce/compose renders the same screen as /produce/studio',
    ta === tc ? '' : `studio: "${ta.slice(0, 120)}" vs compose: "${tc.slice(0, 120)}"`);
  // And neither is the section default by accident: Library is what you get
  // if the slug falls through, since defaultTab is compose — so check the
  // editor's own furniture is present rather than trusting the slug.
  // Matched on the timeline, which is the editor's one irreducible part.
  // This used to look for the card title "Editor" or the "Frame size" label,
  // and both were cut on 9 November — the title named the screen you were
  // already on, and the frame became a sentence. A marker chosen because it
  // happened to be on screen breaks when the screen improves.
  // Against the WHOLE page, not `tc`: that is the first 600 characters, kept
  // short so the identity comparison above does not drown in the timeline's
  // timecodes, and 600 characters of this app is still the nav rail.
  const full = await text(c);
  say(/TIMELINE/i.test(full), 'and it is the editor, not a fallback screen',
    full.slice(0, 200));
  await a.close();
  await c.close();
}

// ── 4. Transcribe and Audio moved group without losing their URLs ────────
for (const [slug, label] of [['transcribe', 'Transcribe'], ['audio', 'Audio'], ['library', 'Library']]) {
  const p = await open(`/clients/c1/produce/${slug}`);
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '');
  say(new RegExp(label, 'i').test(active), `/produce/${slug} lights up ${label}`,
    `active row read "${active}"`);
  await p.close();
}

// ── 5. An unknown slug corrects the URL rather than lying ────────────────
//
// This file's own header warned about the class and then tested only the
// slugs that work, which is how it shipped. Measured on 9 November, before
// the fix: /produce/nonsense, /produce/review and /produce/video each drew
// the composition editor with "Studio" lit in the panel, as though that was
// what you asked for. `review` is the dangerous one, being nearly the slug
// of a real screen (`batch-review`).
//
// The fallback to the default tab is deliberate and stays; what changed is
// that the address bar is corrected to match, so the URL and the nav agree.
for (const [asked, want, row] of [
  ['nonsense',     'studio',       'Studio'],
  ['review',       'studio',       'Studio'],
  ['video',        'studio',       'Studio'],
  // The retired slug redirects to the canonical one rather than resolving
  // quietly under the old address.
  ['compose',      'studio',       'Studio'],
  // A real slug is left exactly alone — this is the half that would catch a
  // redirect rule too eager to fire.
  ['batch-review', 'batch-review', 'Review'],
]) {
  const p = await open(`/clients/c1/produce/${asked}`);
  const landed = new URL(p.url()).pathname.split('/').pop();
  const active = await p.locator('.section-panel a[aria-current="page"], .section-panel .is-active')
    .first().innerText().catch(() => '(none)');
  say(landed === want && new RegExp(row, 'i').test(active),
    `/produce/${asked} lands on /${want} with ${row} lit`,
    `url read /${landed}, active row "${active}"`);
  await p.close();
}

// ── 6. The editor renders a real composition, and the verdict sits beside
//        the picture ────────────────────────────────────────────────────
//
// Until the stub carried compose fixtures the editor drew its empty state in
// every drive, so nothing about it could be checked in a browser and the
// design critique had to intercept /api/compose/* in a script of its own.
//
// These are geometric on purpose. Reel checks being "beside the frame" is not
// something a source read can establish, and the regression it caught is not
// one either: opened, the eight checks measured 964px against the player's
// 500, and because a grid row is as tall as its tallest cell that pushed the
// timeline 460px down and off the screen.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1600, height: 1000 });
  await p.waitForTimeout(600);
  const t = await text(p);

  say(/Atlas showroom reel/.test(t), 'the editor opens a real composition',
    'the stub list must carry `data`: the editor opens list[0] directly rather '
    + 'than fetching it, so a thin row loads an EMPTY composition and every '
    + 'assertion here passes against its empty state');
  say(/Reel checks/i.test(t), 'the reel checks render');
  say(/of 8/.test(t), 'with all eight checks, not the mockup\'s four',
    t.match(/\d of 8[^.]*/)?.[0] || 'no "of 8" on the page');

  const box = async (sel) => { try { return await p.locator(sel).first().boundingBox(); } catch { return null; } };
  const checks = await box('[data-studio-checks]');
  const canvas = await box('canvas');
  say(!!checks && !!canvas, 'the player and the checks are both on screen',
    `checks ${JSON.stringify(checks)} canvas ${JSON.stringify(canvas)}`);

  if (checks && canvas) {
    say(checks.x >= canvas.x + canvas.width - 1,
      'the checks sit to the RIGHT of the frame, in the empty black beside a 9:16 picture',
      `canvas ends at ${Math.round(canvas.x + canvas.width)}, checks start at ${Math.round(checks.x)}`);
    say(Math.abs(checks.y - canvas.y) < 4,
      'and level with its top, rather than below it',
      `canvas y ${Math.round(canvas.y)}, checks y ${Math.round(checks.y)}`);
    say(checks.height <= canvas.height + 8,
      'and no taller than the picture, so the timeline is not pushed off screen',
      `checks ${Math.round(checks.height)}px against a ${Math.round(canvas.height)}px player`);
  }

  // The timeline is the thing you work in. If it is below the fold the layout
  // has failed whatever the panels do.
  const tl = await p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^V1$/.test(d.textContent.trim()));
    return el ? el.getBoundingClientRect().y : null;
  });
  say(tl != null && tl < 1000, 'the timeline is on screen at 1600x1000',
    tl == null ? 'no V1 track header found' : `V1 at y ${Math.round(tl)}`);

  await p.close();
}

// ── 7. The three things the design review ranked above the media bin ────
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1600, height: 1000 });
  await p.waitForTimeout(800);

  // (a) Names on the timeline. It read `11 | 12 | 13` — the editor computes
  // every one of these at load and spent them in one place, the inspector
  // heading, so the clip you had selected was named and the block you were
  // looking at was not.
  const labels = await p.evaluate(() => [...document.querySelectorAll('div')]
    .filter(d => d.style.fontWeight === '700' && d.textContent && d.textContent.length < 60
      && d.parentElement && d.parentElement.style.pointerEvents === 'none')
    .map(d => d.textContent.trim()));
  say(labels.length >= 3, 'the timeline draws labels on its blocks', JSON.stringify(labels));
  say(labels.includes('atlas-walkthrough.mp4') && labels.includes('showroom-01.jpg'),
    'and they are the file names, not the ids', JSON.stringify(labels));
  say(!labels.some(l => /^\d+$/.test(l) || /^[0-9a-f]{8}-/.test(l)),
    'and no block is labelled with a database id', JSON.stringify(labels));

  // (b) A failed save looks like a failure. The stub serves no PUT, so the
  // autosave genuinely fails here — which is why this is checkable at all,
  // and it is the state that used to render in the same size, weight and
  // colour as "Saved".
  const t = await text(p);
  say(/Not saved/.test(t), 'a failed save says so');
  say(/only in this tab/.test(t), 'and says what it means for your work');
  say(/Try again/.test(t), 'and offers a way out');
  const alert = await p.evaluate(() => {
    const el = [...document.querySelectorAll('span')]
      .find(s => /Not saved/.test(s.textContent) && s.getAttribute('role') === 'alert');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { weight: cs.fontWeight, colour: cs.color };
  });
  say(!!alert && Number(alert.weight) >= 700,
    'and is not the same 12px grey as every other state',
    JSON.stringify(alert));

  await p.close();
}

// ── 8. The shelf: where material enters ────────────────────────────────
//
// Before it there was no way to put anything OMI already owns into a
// composition. Not an awkward path: none.
//
// Geometric again, because the placement is the design. A bin BESIDE the
// stage was measured at 1440x900 and would have left the player cell 28px
// wide, so the shelf is a full-width strip instead — and it sits BELOW the
// timeline rather than above it, because above pushed the timeline to y=1018
// on a 900px screen and the timeline is the thing you work in.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(700);
  const box = async (sel) => { try { return await p.locator(sel).first().boundingBox(); } catch { return null; } };

  const shelf = await box('[data-studio-shelf]');
  const canvas = await box('canvas');
  say(!!shelf, 'the shelf is on the screen');
  if (shelf && canvas) {
    say(shelf.width > 500, 'and is full width rather than a column beside the frame',
      `${Math.round(shelf.width)}px; a 240px bin beside the stage would leave the player 28px`);
    say(canvas.width > 240,
      'and the player kept its width', `${Math.round(canvas.width)}px`);
  }

  const v1 = await p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^V1$/.test(d.textContent.trim()));
    return el ? el.getBoundingClientRect().y : null;
  });
  say(v1 != null && v1 < 900,
    'and the timeline is still above the fold at 1440x900',
    `V1 at y ${Math.round(v1)}; it was at 931 before the hero came off this screen`);
  if (shelf && v1 != null) {
    say(shelf.y > v1, 'with the shelf below the timeline, not above it',
      `shelf y ${Math.round(shelf.y)}, V1 y ${Math.round(v1)}`);
  }

  const t = await text(p);
  say(/In this reel/.test(t) && /All footage/.test(t), 'two scopes, the reel first');
  say(/Add files/.test(t), 'and one door for files');
  say(!/\+ Add clip/.test(t) && !/\+ Add music/.test(t),
    'with the inspector no longer offering its own',
    'two buttons for one gesture is the two-doors problem, and the clip one was '
    + 'the only yellow button on the screen while it opened an OS file dialog');

  await p.close();
}

// ── 9. Clicking a tile places it, names it, and selects it ─────────────
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(700);
  const blocks = () => p.evaluate(() => [...document.querySelectorAll('div')]
    .filter(d => d.style.fontWeight === '700' && d.parentElement
      && d.parentElement.style.pointerEvents === 'none')
    .map(d => d.textContent.trim()));

  const before = await blocks();
  await p.locator('[data-studio-shelf] [role="button"]').first().click();
  await p.waitForTimeout(800);
  const after = await blocks();

  say(after.length === before.length + 1, 'a click puts one more block on the timeline',
    `${before.length} -> ${after.length}`);
  const t = await text(p);
  // At the END of the track, never at the playhead: the playhead sits at 0
  // until somebody moves it, so "at the playhead" means "insert at the
  // start", and dropping onto an occupied range raises insert-or-overwrite,
  // which this editor has no answer for.
  say(/added at 00:14:12/.test(t),
    'at the end of the track, and the toast says where it landed',
    t.match(/[\w.\- ]+added at [\d:]+/)?.[0] || 'no toast found');
  // "SELECTED" was the caption of the timeline's selected-item strip, which
  // was deleted when its controls moved into the inspector. Written on
  // 9 November and broken the same day by my own change: the sixth guard in
  // this repo to name a thing that happened to be on screen rather than the
  // claim.
  //
  // The claim is that the inspector is pointed at the new item. Length and
  // Remove are what the inspector renders only when something is selected.
  say(/Length/.test(t) && /Remove/.test(t),
    'and the new item is selected, so a camera move is one more click');

  await p.close();
}

// ── 10. The cuts ───────────────────────────────────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(700);
  const t = await text(p);

  // Autosave is 1500ms, Export flushes before it renders, and the state is
  // displayed — three affordances for one fact, and this was the one that did
  // nothing the other two did not.
  say(!/Save now/.test(t), 'Save now is gone');
  say(!/\bEditor\b/.test(t), 'and the card title that named the screen you are on');

  // Seven chips for two values nobody changes mid-edit, permanently on
  // screen. A sentence, with the decision one click away.
  say(/1080 x 1920 · 30fps/.test(t), 'the frame is stated rather than offered');
  say(!/24fps/.test(t) && !/16:9/.test(t), 'with its chips put away');
  await p.locator('button', { hasText: /^Change$/ }).first().click();
  await p.waitForTimeout(400);
  const t2 = await text(p);
  say(/24fps/.test(t2) && /16:9/.test(t2), 'and back on Change, so nothing was lost');

  // The header row ran to x=1498 inside a card ending at 1400, which put
  // "Save now" 58px outside a 1440 viewport.
  const right = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter(x => /Export|Share|Ripple/.test(x.textContent));
    return btns.length ? Math.round(Math.max(...btns.map(x => x.getBoundingClientRect().right))) : null;
  });
  say(right != null && right < 1440, 'and the header row fits its viewport again',
    `rightmost control at x=${right}, viewport 1440; it was 1498`);

  await p.close();
}

// ── 11. Export asks one question ───────────────────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(700);
  await p.locator('button', { hasText: /^Export$/ }).first().click();
  await p.waitForTimeout(800);
  // Scoped to the dialog: "Low" and "Medium" appear elsewhere on the page,
  // and a page-wide match passed while the modal still carried its chips.
  const modal = await p.locator('.modal, [role="dialog"]').first().innerText().catch(() => '');
  const m = modal.replace(/\s+/g, ' ');
  say(/Format/.test(m), 'the export dialog opens', m.slice(0, 120));
  say(!/1080p|720p|480p/.test(m),
    'and no longer offers three landscape resolutions to a 9:16 reel');
  say(!/Medium/.test(m) && !/\bLow\b/.test(m),
    'nor two ways to make a worse file');
  say(/Est\. size/.test(m) || /Duration:/.test(m),
    'while still saying what you are about to hand someone', m.slice(0, 160));
  await p.close();
}

// ── 12. One inspector ──────────────────────────────────────────────────
//
// The timeline carried its own selected-item strip: a second inspector 700px
// below the first. The two disagreed about volume — this one 0–2 with a
// `Math.min(2, …)` clamp, the other 0–4 — for the same number on the same
// item, so an item set to 3.5 above read as 2 below and touching the lower
// slider wrote the clamped value back.
//
// Deleting it was only safe because its three controls moved first: `trans:`
// appeared in exactly two lines of JSX in the whole frontend and both were in
// that strip, so a cut without a rehome would have taken dissolves out of the
// product. These assertions are the proof that the move happened.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(900);

  // The SECOND block on the video track, because a transition is between an
  // item and the one before it and the first has nothing to transition from.
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'showroom-01.jpg' && d.style.fontWeight === '700');
    if (!label) return null;
    let el = label;
    for (let i = 0; i < 6 && el; i++) {
      if (getComputedStyle(el).position === 'absolute'
        && el.getBoundingClientRect().width > 20) {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      el = el.parentElement;
    }
    return null;
  });
  say(!!hit, 'a timeline block can be selected', hit ? JSON.stringify(hit) : 'no block found');
  if (hit) {
    await p.mouse.click(hit.x, hit.y);
    await p.waitForTimeout(600);
    const t = await text(p);

    say(/Transition in/.test(t), 'the inspector offers the transition');
    say(/Fade/.test(t) && /Via black/.test(t) && /Dissolve/.test(t),
      'with every type the model has, so nothing was lost with the strip');
    say(/Opacity:/.test(t), 'and opacity');
    say(/Fill frame/.test(t) && /Letterbox/.test(t), 'and fit');
    say(!/\bCover\b/.test(t) && !/\bContain\b/.test(t),
      'in ONE vocabulary — the inspector used to say Cover and Contain for the '
      + 'same two values the timeline called Fill frame and Letterbox');

    // The fault this whole move was for.
    const maxes = await p.evaluate(() => [...document.querySelectorAll('input[type=range]')]
      .map(i => i.max));
    say(maxes.filter(m => m === '2').length === 0,
      'and there is no 0–2 volume slider left to disagree with the 0–4 one',
      `range inputs: ${JSON.stringify(maxes)}`);
    say(maxes.includes('4'), 'while volume still runs to the model\'s own bound',
      `range inputs: ${JSON.stringify(maxes)}`);
  }

  await p.close();
}

say(errs.length === 0, 'no page errors', errs.join(' | '));

await b.close();
console.log(`\n${fails === 0 ? 'ALL' : 'SOME'} — ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

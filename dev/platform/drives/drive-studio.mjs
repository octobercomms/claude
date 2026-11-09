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

// The lit row in the section panel, and something useful when there is not
// one. A sweep run of this file reported `active row read ""` for the first
// assertion while the three after it read correctly — the locator's own
// failure, swallowed by a `.catch(() => '')`, which made a page that had not
// finished loading look like a wrong nav state. It waits for the panel, then
// for a lit row, and says which of the two is missing.
const activeRow = async (p) => {
  const panel = p.locator('.section-panel').first();
  try { await panel.waitFor({ state: 'visible', timeout: 15000 }); }
  catch { return '<the section panel never rendered>'; }
  const lit = p.locator('.section-panel a[aria-current="page"], .section-panel .is-active').first();
  try { await lit.waitFor({ state: 'attached', timeout: 15000 }); }
  catch {
    const rows = await p.locator('.section-panel a').allInnerTexts().catch(() => []);
    return `<panel rendered with no lit row; it offers ${rows.join(' / ') || 'nothing'}>`;
  }
  return (await lit.innerText().catch(() => '<lit row unreadable>')).trim();
};

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
  const active = await activeRow(p);
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
  // Matched on the timeline, which is the editor's one irreducible part —
  // but on the ELEMENT, not on a word printed above it.
  //
  // This has now been written three ways. It looked for the card title
  // "Editor", then for the "Frame size" label, then for the word TIMELINE in
  // the page text, and each of those was cut in turn as the screen improved:
  // the title named the screen you were already on, the frame became a
  // sentence, and the caption was the third copy of the duration. Three
  // markers, one claim. The claim is that the editor rendered, and the thing
  // that cannot be true without it is the timeline component itself.
  const hasTimeline = await c.locator('[data-testid="composition-timeline"]').count();
  const hasLanes = await c.locator('text=V1').count();
  say(hasTimeline > 0 && hasLanes > 0, 'and it is the editor, not a fallback screen',
    `timeline elements: ${hasTimeline}, lanes: ${hasLanes}`);
  await a.close();
  await c.close();
}

// ── 4. Transcribe and Audio moved group without losing their URLs ────────
for (const [slug, label] of [['transcribe', 'Transcribe'], ['audio', 'Audio'], ['library', 'Library']]) {
  const p = await open(`/clients/c1/produce/${slug}`);
  const active = await activeRow(p);
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
  const active = await activeRow(p);
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
  // The COUNT, read off the page rather than typed in here. This said `of 8`
  // and two checks were added the same day — the twelfth assertion in this
  // repo to name a number or a word that the product then moved. The claim is
  // that the shipped checks beat the mockup's four.
  const checkCount = Number((await text(p)).match(/\d+ of (\d+)/)?.[1] || 0);
  say(checkCount >= 8, 'with every shipped check, not the mockup\'s four',
    `${checkCount} checks on the page`);

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
  //
  // An EDIT is made first, and that is the point of the change rather than a
  // detail of the test. These four assertions used to pass on a page nobody
  // had touched, because opening a reel scheduled a save: the editor wrote to
  // the database for merely being looked at, and the red "your last change is
  // only in this tab" was about a change that did not exist. An edit nobody
  // can save is worth shouting about. Opening a reel is not.
  await p.route('**/api/compose/compositions/*', (route) => (
    route.request().method() === 'PUT' ? route.abort() : route.continue()));
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'showroom-01.jpg' && d.style.fontWeight === '700');
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
  if (hit) {
    await p.mouse.click(hit.x, hit.y);
    await p.waitForTimeout(400);
    const slider = p.locator('input[type=range]').first();
    await slider.fill('2.5');
    await slider.dispatchEvent('change');
    await p.waitForTimeout(2600);
  }
  say(!!hit, 'a clip can be edited, so the save state has something to report');
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
  // The claim is that the editor is pointed at the new item. `Length` is an
  // inspector row that renders only with a selection, and the toolbar's
  // Delete is enabled only with one — two independent consequences of the
  // claim rather than two names from the same screen.
  //
  // This is the NINTH guard in this repo to be written against a marker.
  // `Remove` stood here until the toolbar took the gesture and the
  // inspector's duplicate was deleted; the test would have failed on a
  // change that made the product better, which is the whole pattern.
  const deleteLive = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.textContent.trim() === 'Delete');
    return !!b && !b.disabled;
  });
  say(/Length/.test(t) && deleteLive,
    'and the new item is selected, so a camera move is one more click',
    `Length in the inspector: ${/Length/.test(t)}, toolbar Delete live: ${deleteLive}`);

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

// ── 11. Looking is not editing, leaving is not losing ────────────────────
//
// Three faults that lived together. Opening a reel scheduled a save, so the
// editor wrote to the database for being looked at — and `compositions.list`
// orders by `updated_at`, so browsing three reels to find the right one
// restamped and reordered all three. Switching reels guarded the `unsaved`
// state and let `error` through, so the control sitting beside "your last
// change is only in this tab" threw that change away without asking. And the
// share link never carried the reel's name, because the editor held the
// composition's `data` and not its row.
{
  const writes = [];
  const p = await b.newPage();
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`section 11: ${e.message}`);
  });
  const shared = [];
  p.on('request', (r) => {
    const u = new URL(r.url()).pathname;
    if (['PUT', 'POST', 'PATCH'].includes(r.method())) writes.push(`${r.method()} ${u}`);
    if (r.method() === 'POST' && /\/approvals\/clients\/[^/]+\/links$/.test(u)) {
      try { shared.push(JSON.parse(r.postData() || '{}')); } catch { shared.push(null); }
    }
  });
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/studio', { waitUntil: 'networkidle' });
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(2600);

  say(writes.length === 0, 'opening a reel writes nothing at all',
    `${JSON.stringify(writes)} — a save on open bumps updated_at, and that column `
    + 'is the order of the list you are browsing and the only thing telling two '
    + '"Untitled" reels apart');
  const afterOpen = await text(p);
  say(/Saved/.test(afterOpen) && !/Not saved/.test(afterOpen),
    'and an untouched reel does not claim your work is at risk',
    'the red alert used to be the loudest thing on the screen on a page where '
    + 'nothing had been changed');

  // Now edit, let the save fail, and try to walk away from it.
  await p.route('**/api/compose/compositions/*', (route) => (
    route.request().method() === 'PUT' ? route.abort() : route.continue()));
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'showroom-01.jpg' && d.style.fontWeight === '700');
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
  if (hit) {
    await p.mouse.click(hit.x, hit.y);
    await p.waitForTimeout(400);
    const slider = p.locator('input[type=range]').first();
    await slider.fill('2.5');
    await slider.dispatchEvent('change');
    await p.waitForTimeout(2600);
  }
  say(/Not saved/.test(await text(p)), 'an edit the stub refuses reports as not saved');

  const heading = async () => (await p.locator('h1.h1').first().innerText().catch(() => '')).trim();
  const before = await heading();
  await p.locator('select[aria-label="Open another reel"]').first()
    .selectOption('2').catch(() => {});
  await p.waitForTimeout(1500);
  const after = await heading();
  say(before === 'Atlas showroom reel' && after === before,
    'switching reels with an unsavable edit in hand does not switch',
    `heading went "${before}" → "${after}" — it used to load the other reel and the `
    + 'edit was gone, with the warning about it still on screen');
  say(/stays open/.test(await text(p)),
    'and it says why rather than failing silently');

  // The share link's heading.
  await p.locator('button', { hasText: /^Share$/ }).first().click();
  await p.waitForTimeout(900);
  const make = p.locator('button', { hasText: /^Make the link$/ }).first();
  const canMake = await make.isEnabled().catch(() => false);
  say(canMake, 'the share dialog offers a render to send');
  if (canMake) {
    await make.click();
    await p.waitForTimeout(1200);
    const sentTitle = shared[0]?.title || '';
    say(/Atlas showroom reel/.test(sentTitle),
      "the share link carries the reel's name",
      `title sent: "${sentTitle}" — the editor held the composition's data, which has `
      + 'no title in it, so every link a client received was called "Reel — for your review"');
  }

  await p.close();
}

// ── 12. The top bar ──────────────────────────────────────────────────────
//
// What it replaces: a composition `<select>` as the first thing on the page,
// with the save state pushed to the far right of the same row, under the
// fixed connector indicator. The reel had no address at all — `openCompId`
// was component state — so it could not be linked, pasted or reached with
// Back, and that, rather than its styling, is what made the select
// load-bearing.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.waitForTimeout(900);

  const bar = await p.evaluate(() => {
    const h1 = document.querySelector('h1.h1');
    const screenName = document.querySelector('h2.ds-shell__screen');
    const btn = (label) => [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === label);
    const saved = [...document.querySelectorAll('span')]
      .find((x) => /^(Saved|Saving…)$/.test(x.textContent.trim()));
    const box = (e) => (e ? (({ x, y, width }) => ({
      x: Math.round(x), y: Math.round(y), w: Math.round(width),
    }))(e.getBoundingClientRect()) : null);
    const exp = btn('Export');
    const play = document.querySelector('[data-testid="play"]');
    return {
      title: h1?.textContent?.trim() || null,
      titleBox: box(h1),
      screenName: screenName?.textContent?.trim() || null,
      exportClass: exp?.className || null,
      playClass: play?.className || null,
      savedBox: box(saved), savedText: saved?.textContent?.trim() || null,
      picker: document.querySelector('select[aria-label="Open another reel"]')?.value,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  say(bar.title === 'Atlas showroom reel',
    "the heading is the reel's name", `heading reads "${bar.title}"`);
  say(bar.screenName === null,
    'and not the name of the screen you are already on',
    `${bar.screenName} — an h2 reading "Studio", inside the section whose panel `
    + 'header says PRODUCE, next to the lit row that also says Studio');
  say(!!bar.savedBox && !!bar.titleBox
    && bar.savedBox.x - (bar.titleBox.x + bar.titleBox.w) < 120,
    'the save state sits beside the work it describes',
    `title ends at ${bar.titleBox?.x + bar.titleBox?.w}, save state at ${bar.savedBox?.x} — `
    + 'it used to be right-aligned 35px under the fixed connector indicator, where it '
    + 'read as part of that status cluster');
  say(/btn-primary/.test(bar.exportClass || ''),
    'Export is the one primary on the screen', `Export: ${bar.exportClass}`);
  say(!/btn-primary/.test(bar.playClass || ''),
    'and Play no longer outranks it',
    `Play: ${bar.playClass} — the most emphasised control in the Studio was "play the `
    + 'preview" while the thing the screen exists to produce was drawn like "-1 frame"');
  say(bar.picker === '',
    'the reel picker reads as a verb rather than repeating the title',
    `picker value "${bar.picker}"`);
  say(bar.overflow === 0, 'and the bar does not overflow at 1280',
    `${bar.overflow}px of horizontal scroll`);

  // Renaming, which is the reason the bar is worth building: without it the
  // name is a label nobody can change and "Untitled" is permanent.
  const renamed = [];
  p.on('request', (r) => {
    if (r.method() !== 'PUT') return;
    try {
      const body = JSON.parse(r.postData() || '{}');
      if (body.title !== undefined) renamed.push(body);
    } catch { /* not ours */ }
  });
  await p.locator('button[aria-label="Rename this reel"]').first().click();
  await p.waitForTimeout(300);
  const field = p.locator('input[aria-label="Reel name"]').first();
  say(await field.count() > 0, 'the name can be edited in place');
  await field.fill('Oculi Mundi autumn');
  await field.press('Enter');
  await p.waitForTimeout(1200);
  const after = (await p.locator('h1.h1').first().innerText().catch(() => '')).trim();
  say(after === 'Oculi Mundi autumn', 'and the new name is on the page',
    `heading reads "${after}"`);
  say(renamed.length === 1 && renamed[0].title === 'Oculi Mundi autumn'
    && renamed[0].data === undefined,
    'and a rename sends the title ALONE',
    `${JSON.stringify(renamed)} — compositions.update sets only the fields it is `
    + 'given, so a rename carrying `data` could write a stale timeline over an '
    + 'edit in flight');

  await p.close();
}

// ── 13. A reel has an address ────────────────────────────────────────────
{
  const p = await open('/clients/c1/produce/studio?open=2');
  await p.waitForTimeout(1200);
  const title = (await p.locator('h1.h1').first().innerText().catch(() => '')).trim();
  say(title === 'Material study', 'a pasted link opens the reel it names',
    `heading reads "${title}" — the editor used to open the first row of its own `
    + 'list whatever the address said, because the open reel was component state');

  await p.locator('select[aria-label="Open another reel"]').first().selectOption('1');
  await p.waitForTimeout(1400);
  say(/open=1/.test(p.url()), 'and opening another reel changes the address',
    `url is ${p.url()} — Back, a refresh and a pasted link all have to agree with `
    + 'what is on screen, and they cannot while the answer lives in a component');
  const after = (await p.locator('h1.h1').first().innerText().catch(() => '')).trim();
  say(after === 'Atlas showroom reel', 'and the screen follows the address',
    `heading reads "${after}"`);
  await p.close();
}

// ── 14. The chip that did not exist ──────────────────────────────────────
//
// Seventeen controls in the Studio carry `btn-chip` and seven of them pass
// `is-active`. Nothing in any stylesheet matched either class, so all of them
// rendered as native buttons — measured at 14px tall, #efefef, no border, no
// radius, weight 400 — and `is-active` meant NOTHING: the selected camera
// move, the selected transition, the selected fit and the shelf's selected
// scope were pixel for pixel identical to the unselected ones. The camera
// moves shipped this morning with no way to see which one was on.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(900);
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'showroom-01.jpg' && d.style.fontWeight === '700');
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
  if (hit) { await p.mouse.click(hit.x, hit.y); await p.waitForTimeout(500); }

  const chips = await p.evaluate(() => [...document.querySelectorAll('.btn-chip')].map((e) => {
    const c = getComputedStyle(e);
    return {
      text: e.textContent.trim().slice(0, 14),
      active: e.classList.contains('is-active'),
      height: Math.round(e.getBoundingClientRect().height),
      border: c.borderTopWidth, radius: c.borderTopLeftRadius,
      weight: c.fontWeight, bg: c.backgroundColor, colour: c.color,
    };
  }));

  say(chips.length > 10, 'the Studio is full of chips', `${chips.length} of them`);
  say(chips.every(c => c.height >= 24 && c.border !== '0px' && c.radius !== '0px'),
    'and every one of them is a chip rather than a native button',
    JSON.stringify(chips.find(c => c.height < 24 || c.border === '0px' || c.radius === '0px')
      || 'all styled')
    + ' — they measured 14px tall, #efefef, no border, no radius, next to a 36px pill');

  const on = chips.filter(c => c.active);
  const off = chips.filter(c => !c.active);
  say(on.length > 0 && off.length > 0, 'with some on and some off',
    `${on.length} on, ${off.length} off`);
  say(on.every(c => c.bg !== off[0].bg && c.colour !== off[0].colour),
    'and the one that is ON looks different from the ones that are not',
    `on ${on[0]?.bg}/${on[0]?.colour} against off ${off[0]?.bg}/${off[0]?.colour} — `
    + 'these were identical, so the selected camera move was invisible');
  say(on.some(c => /push-in|Hold|drift|rise|orbit|reveal|subtle/.test(c.text)),
    'including the camera move on the selected photograph',
    JSON.stringify(on.map(c => c.text)));

  // The other half of the same fault: `--primary` is defined nowhere, and two
  // sliders asked for it. An invalid accent-color falls back to the browser's
  // own blue, which made them the only blue controls in OMI.
  const accents = await p.evaluate(() => [...document.querySelectorAll('input[type=range]')]
    .map(i => getComputedStyle(i).accentColor));
  say(accents.length > 0 && accents.every(a => a !== 'auto'),
    'and no slider is left on the browser\'s own blue',
    `accent colours: ${JSON.stringify(accents)}`);

  await p.close();
}

// ── 15. The keys fire after you click the thing you want to edit ─────────
//
// Measured on the shipped build: click a clip, the inspector opens, press
// Delete — nothing. Press S — nothing. The editing keys lived on the timeline
// lane's own keydown and fired only when that div had DOM focus, and clicking
// a CLIP does not focus it; clicking the ruler does. So the keys worked or
// did not depending on where you last clicked, and the loser was whoever
// clicked the thing they wanted to edit. Tab did not reach the lane either,
// in forty presses. Meanwhile the timeline printed a paragraph underneath
// itself telling you to press those keys.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(900);
  const blocks = () => p.evaluate(() => [...document.querySelectorAll('div')]
    .filter(d => d.style.fontWeight === '700' && d.parentElement
      && d.parentElement.style.pointerEvents === 'none')
    .map(d => d.textContent.trim()));
  const pick = async (name) => {
    const hit = await p.evaluate((n) => {
      const label = [...document.querySelectorAll('div')]
        .find(d => d.textContent.trim() === n && d.style.fontWeight === '700');
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
    }, name);
    if (hit) { await p.mouse.click(hit.x, hit.y); await p.waitForTimeout(350); }
    return hit;
  };
  const focused = () => p.evaluate(() => document.activeElement.tagName);

  await pick('showroom-01.jpg');
  say(await focused() === 'BODY',
    'clicking a clip still does not focus the timeline lane',
    'which is the fault these assertions are about: the keys must not depend on it');

  const before = await blocks();
  await p.keyboard.press('Delete');
  await p.waitForTimeout(500);
  const after = await blocks();
  say(before.includes('showroom-01.jpg') && !after.includes('showroom-01.jpg'),
    'Delete removes the clip you clicked',
    `${JSON.stringify(before)} → ${JSON.stringify(after)} — this did nothing at all`);

  // Split, and the half that was being thrown away: the new piece is the one
  // selected, so you can cut, move on, cut again and delete the middle.
  const counted = async () => (await blocks()).length;
  await pick('atlas-walkthrough.mp4');
  const n0 = await counted();
  await p.keyboard.press('ArrowRight');
  for (let i = 0; i < 12; i += 1) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(300);
  await p.keyboard.press('s');
  await p.waitForTimeout(600);
  const n1 = await counted();
  say(n1 === n0 + 1, 'S splits the selected clip at the playhead',
    `${n0} blocks → ${n1}`);
  const lengths = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find(r => r.textContent.includes('At'));
    return row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  say(!!lengths && !/00:00:00/.test(lengths),
    'and the piece left selected is the SECOND one',
    `${lengths} — splitItem has always returned the new id and the handler threw `
    + 'it away, so you were left holding the half you had already finished with');

  // The playhead, with one meaning for the arrows.
  const timecode = () => p.evaluate(() => {
    const el = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && /^\d\d:\d\d:\d\d \/ \d\d:\d\d:\d\d/.test(e.textContent.trim()));
    return el ? el.textContent.trim().split('/')[0].trim() : null;
  });
  const t0 = await timecode();
  await p.keyboard.press('Shift+ArrowRight');
  await p.waitForTimeout(400);
  const t1 = await timecode();
  say(!!t0 && !!t1 && t0 !== t1, 'Shift and an arrow move the playhead a second',
    `${t0} → ${t1} — the shortcut panel promised this and Compositor.jsx `
    + 'explicitly ignored shifted arrows, so it had never once worked');

  await p.close();
}

// ── 16. The timeline has a toolbar ───────────────────────────────────────
//
// Step 4. Until now the only controls that acted on the timeline were in the
// inspector's header, and measured at 1440x900 with the timeline scrolled
// into view every one of them sat at y = -301. At 1280 the inspector's
// Remove was at y = -86 and the Delete key did nothing, so THERE WAS NO
// REACHABLE WAY TO DELETE A CLIP.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(900);
  const btn = (label) => p.locator('button', { hasText: new RegExp(`^${label}$`) }).first();
  const state = async () => p.evaluate(() => {
    const b = (t) => [...document.querySelectorAll('button')]
      .find(x => x.textContent.trim() === t);
    const box = (e) => (e ? (({ x, y, width }) => ({
      x: Math.round(x), y: Math.round(y), w: Math.round(width),
    }))(e.getBoundingClientRect()) : null);
    const tl = document.querySelector('[data-testid="composition-timeline"]');
    return {
      split: !!b('Split'), delete: !!b('Delete'),
      splitOff: b('Split')?.disabled, deleteOff: b('Delete')?.disabled,
      splitBox: box(b('Split')), undoBox: box(b('\u21a9')),
      timeline: tl ? Math.round(tl.getBoundingClientRect().height) : null,
      remove: !!b('Remove'), ripple: !!b('Ripple'),
      caption: /\d tracks · \d\d:/.test(document.body.innerText),
      prose: /alt-arrows trim/.test(document.body.innerText),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  let st = await state();
  say(st.split && st.delete, 'Split and Delete are on the timeline');
  say(st.splitOff && st.deleteOff, 'and both are off with nothing selected',
    `split ${st.splitOff}, delete ${st.deleteOff} — a toolbar that offers a `
    + 'destructive verb for a selection that does not exist is a trap');
  say(!st.remove,
    "and the inspector's Remove is gone, not duplicated",
    'two doors for one gesture, and that one was at y = -86 at this width');
  say(!st.ripple, 'the ripple mode is gone',
    'it shifted ONE track, so a ripple delete on the picture left the music at '
    + 'full length and the reel ended on music over nothing');
  say(!st.caption, 'the third copy of the duration is gone',
    'the transport and the inspector footer both already say it');
  say(!st.prose, 'and the paragraph that listed the keyboard in prose',
    'it named two keys that no longer mean what it said and three that could '
    + 'not be fired from the gesture that selects a clip');
  say(st.overflow === 0 && st.timeline !== null && st.timeline < 240,
    'the timeline block is shorter than it was',
    `${st.timeline}px, against 292 before — caption 14, minimap 40, prose 50`);

  // Now select something, and watch the two verbs wake up.
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'atlas-walkthrough.mp4' && d.style.fontWeight === '700');
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
  await p.mouse.click(hit.x, hit.y);
  await p.waitForTimeout(400);
  st = await state();
  say(!st.deleteOff, 'Delete wakes up when a clip is selected');
  say(!st.splitOff,
    'and so does Split, before the playhead is anywhere near it',
    'greying Split on the playhead would hide the one precondition a person '
    + 'cannot see — a relationship between two things on screen — and a grey '
    + 'control reads as "splitting does not work on this clip"');

  // So it has to SAY what it needs, to the person who just asked for it.
  await btn('Split').click();
  await p.waitForTimeout(700);
  const asked = await p.evaluate(() => [...document.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && /playhead where you want/.test(e.textContent))
    .map(e => e.textContent.trim())[0] || null);
  say(!!asked, 'and says what it needs instead of doing nothing', `${asked}`);

  for (let i = 0; i < 20; i += 1) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(400);

  const blocks = () => p.evaluate(() => [...document.querySelectorAll('div')]
    .filter(d => d.style.fontWeight === '700' && d.parentElement
      && d.parentElement.style.pointerEvents === 'none')
    .map(d => d.textContent.trim()));
  const n0 = (await blocks()).length;
  await btn('Split').click();
  await p.waitForTimeout(500);
  say((await blocks()).length === n0 + 1, 'the button splits what the key splits',
    `${n0} blocks → ${(await blocks()).length}`);
  await btn('Delete').click();
  await p.waitForTimeout(700);
  say((await blocks()).length === n0, 'and Delete removes it again',
    `back to ${(await blocks()).length}`);
  // One button with two behaviours and no voice is how an operator learns to
  // distrust a toolbar: sometimes the rest of the reel jumps left, sometimes
  // nothing moves, and nothing says which rule you were under.
  const said = await p.evaluate(() => [...document.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && /^Removed .+\. Reel is now /.test(e.textContent))
    .map(e => e.textContent.trim())[0] || null);
  say(!!said, 'and says what it removed and what the reel is now', `${said}`);

  await p.close();
}

// ── 17. Delete closes the gap, when there is a gap to close ──────────────
//
// What replaced the ripple mode. The mode shifted one track whatever the
// shape of the reel, so a cutaway floating on its own track got slid earlier
// by a delete somewhere else, silently. What a person means by "close the
// gap" is narrower: the clip after this one was butted against it, so pull
// it back.
{
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(900);

  const clickBlock = async (name) => {
    const hit = await p.evaluate((n) => {
      const label = [...document.querySelectorAll('div')]
        .find(d => d.textContent.trim() === n && d.style.fontWeight === '700');
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
    }, name);
    if (!hit) return false;
    await p.mouse.click(hit.x, hit.y);
    await p.waitForTimeout(350);
    return true;
  };
  // The inspector's own "At" row, which is the item's start time.
  const startOf = async (name) => {
    if (!await clickBlock(name)) return null;
    return p.evaluate(() => {
      const row = [...document.querySelectorAll('tr')]
        .find(r => r.children[0]?.textContent.trim() === 'At');
      return row ? row.children[1].textContent.trim() : null;
    });
  };

  const before = await startOf('showroom-02.jpg');
  await clickBlock('showroom-01.jpg');
  await p.keyboard.press('Delete');
  await p.waitForTimeout(600);
  const after = await startOf('showroom-02.jpg');
  say(!!before && !!after && before !== after,
    'removing a clip pulls the one butted against it back',
    `showroom-02 started at ${before} and now starts at ${after} — this is what `
    + '"close the gap" means, and it used to need a mode you could not see');

  // And the case the mode got wrong: a clip with air in front of it stays
  // where the edit put it.
  const q = await open('/clients/c1/produce/studio');
  await q.setViewportSize({ width: 1440, height: 1200 });
  await q.waitForTimeout(900);
  const clickOn = async (page, name) => {
    const hit = await page.evaluate((n) => {
      const label = [...document.querySelectorAll('div')]
        .find(d => d.textContent.trim() === n && d.style.fontWeight === '700');
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
    }, name);
    if (!hit) return false;
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(350);
    return true;
  };
  const startOn = async (page, name) => {
    if (!await clickOn(page, name)) return null;
    return page.evaluate(() => {
      const row = [...document.querySelectorAll('tr')]
        .find(r => r.children[0]?.textContent.trim() === 'At');
      return row ? row.children[1].textContent.trim() : null;
    });
  };

  // Push the last clip two seconds later, which puts air in front of it.
  await clickOn(q, 'showroom-02.jpg');
  await q.keyboard.press('Shift+.');
  await q.keyboard.press('Shift+.');
  await q.waitForTimeout(400);
  const moved = await startOn(q, 'showroom-02.jpg');
  await clickOn(q, 'showroom-01.jpg');
  await q.keyboard.press('Delete');
  await q.waitForTimeout(600);
  const stayed = await startOn(q, 'showroom-02.jpg');
  say(!!moved && moved === stayed,
    'and a clip with air in front of it does not move',
    `it was at ${moved} and is at ${stayed} — the ripple mode slid this one `
    + 'earlier whatever the edit meant, and on another track entirely it would '
    + 'have slid the music under a picture that had not changed');

  await p.close();
  await q.close();
}

// ── 18. An empty reel, and a safety net that does not fire for nothing ───
{
  // Reel 2 in the stub has no tracks at all, which is what `+ New` makes.
  const p = await open('/clients/c1/produce/studio?open=2');
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.waitForTimeout(1000);
  const t = await text(p);
  const verbs = await p.evaluate(() => [...document.querySelectorAll('button')]
    .filter(b => /^(Split|Delete|↩|↪)$/.test(b.textContent.trim()))
    .map(b => ({ t: b.textContent.trim(), off: b.disabled })));
  say(/add a clip to start editing/i.test(t),
    'an empty reel is told what to do rather than shown four dead verbs',
    'on a reel with nothing in it none of the four can ever be live, so they '
    + 'are not "not yet" — they are decoration that looks broken, and they are '
    + 'the first thing the Studio shows somebody who has just made a reel');
  say(verbs.length === 0, 'and the verbs are not drawn at all',
    JSON.stringify(verbs));
  say(/Fit/.test(t), 'while zoom and the shortcuts stay, because they always mean something');
  await p.close();
}

{
  // Clicking a clip and moving nothing used to commit a history entry, so
  // SELECTING lit Undo — and pressing it changed nothing and handed back a
  // Redo. A safety net that fires and does nothing is worse than no net.
  const p = await open('/clients/c1/produce/studio');
  await p.setViewportSize({ width: 1440, height: 1200 });
  await p.waitForTimeout(900);
  const undoOff = () => p.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === '\u21a9')?.disabled);
  say(await undoOff() === true, 'Undo is off on a reel nobody has edited');
  const hit = await p.evaluate(() => {
    const label = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === 'showroom-01.jpg' && d.style.fontWeight === '700');
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
  await p.mouse.click(hit.x, hit.y);
  await p.waitForTimeout(500);
  say(await undoOff() === true,
    'and still off after a click that selected a clip and moved nothing',
    'a pointer-down and a pointer-up with no move between them is not an edit');
  await p.close();
}

say(errs.length === 0, 'no page errors', errs.join(' | '));

await b.close();
console.log(`\n${fails === 0 ? 'ALL' : 'SOME'} — ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

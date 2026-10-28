/**
 * The caption compiler: a template, a client and a transcript into one ASS file.
 *
 * Two things are checked here and they are different in kind. The first is the
 * compiler's own arithmetic — colour order, timestamps, which word carries the
 * animation — which is pure and testable anywhere. The second is that ffmpeg
 * actually burns what comes out, for every one of the 27 presets, because an
 * ASS file that parses and an ASS file that renders are not the same claim and
 * the gap between them is where a template silently paints nothing.
 *
 *   node tests/captions.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const SHARED = path.join(__dirname, '..', '..', 'shared', 'captions');
const FONTS = path.join(SHARED, 'fonts');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

const WORDS = [
  { word: 'Fifteen', start: 0.0, end: 0.42 },
  { word: 'years', start: 0.42, end: 0.78 },
  { word: 'later', start: 0.78, end: 1.12 },
  { word: 'the', start: 1.12, end: 1.26 },
  { word: 'company', start: 1.26, end: 1.8 },
];

async function main() {
  const m = await import(pathToFileURL(path.join(SHARED, 'compile.mjs')).href);
  const cfg = JSON.parse(fs.readFileSync(path.join(SHARED, 'presets.json'), 'utf8'));
  const styles = cfg.styles;
  const vertical = cfg.outputFormats.vertical;

  console.log('The ported library arrived intact');
  // Counted as the PORTED subset, not the total: the library grows every time a
  // reel is measured, and a test that breaks on each addition teaches nothing.
  const ported = Object.values(styles).filter((x) => x.category !== 'measured');
  ok(ported.length === 27, `${ported.length} ported presets`);
  ok(/MIT/.test(cfg._source.licence) && /Capite/.test(cfg._source.notice),
    'and the licence they came under is recorded with them');
  ok(Object.values(styles).every((s) => s.fontName && s.fontSize && s.animationType),
    'every preset has the three fields the compiler cannot work without');
  // video_projects.caption_template is VARCHAR(40). A longer id would be
  // truncated on save and then fail to resolve on render, which reads as a
  // template that silently stopped working.
  const tooLong = Object.keys(styles).filter((id) => id.length > 40);
  ok(tooLong.length === 0, `every id fits the column${tooLong.length ? `: ${tooLong}` : ''}`);

  console.log('\nColours convert to the order ASS wants, not the order people write');
  // &HAABBGGRR. Getting this backwards is invisible until a client's red
  // renders blue, which is the kind of thing nobody checks twice.
  ok(m.toAss('#E7CD41') === '&H0041CDE7', 'hex RGB becomes BGR');
  ok(m.toAss('#000000', 128) === '&H80000000', 'and alpha rides in front');
  ok(m.toAss('#fff') === '&H00FFFFFF', 'three-digit hex expands');
  ok(m.toAss(null) === '&H00000000', 'a missing colour is black, never NaN');

  console.log('\nTimestamps are centiseconds, which is all the format carries');
  ok(m.stamp(0) === '0:00:00.00', 'zero');
  ok(m.stamp(3661.5) === '1:01:01.50', 'past an hour');
  ok(m.stamp(-4) === '0:00:00.00', 'a negative start cannot produce a broken line');

  console.log('\nA client kit may change its own colours and nothing else');
  const base = styles.hormozi;
  const skinned = m.skin(base, { font: 'Inter', ink: '#EFE7DA', accent: '#C8701E', fontSize: 400 });
  ok(skinned.fontName === 'Inter' && skinned.primaryColor === '#EFE7DA'
    && skinned.highlightColor === '#C8701E', 'typeface and palette come from the kit');
  ok(skinned.fontSize === base.fontSize,
    'but not the size: a kit that resized a template would make "the Nordic one" '
    + 'mean something different on every account');
  ok(m.skin(base, null).fontName === base.fontName, 'no kit leaves the template as drawn');
  ok(base.primaryColor === '#FFFFFF', 'and the preset itself was not mutated');

  console.log('\nOne line per spoken word, with only that word animated');
  const ass = m.compile({ words: WORDS, preset: styles.pop || styles.hormozi, format: vertical });
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  ok(events.length === WORDS.length, `${WORDS.length} words produce ${events.length} lines`);
  ok(events[0].includes('Fifteen') && events[0].includes('years'),
    'each line shows its whole group, so neighbours stay on screen');
  ok((events[0].match(/\\fsc|\\c&H/g) || []).length >= 1, 'the active word carries the override');
  ok(events[0].split('{\\r}').length >= 2, 'and the others are reset to the base style');

  console.log('\nGrouping keeps a long sentence inside the frame');
  ok(m.group(WORDS, 3).length === 2, 'five words at three per line is two lines');
  ok(m.group(WORDS, 3)[1].length === 2, 'the last line carries the remainder');

  console.log('\nEvery engine in the library is one the compiler implements');
  const used = new Set(Object.values(styles).map((s) => s.animationType));
  const missing = [...used].filter((e) => !m.ENGINE_NAMES.includes(e));
  ok(missing.length === 0, `all ${used.size} engines implemented${missing.length ? `: missing ${missing}` : ''}`);

  console.log('\nThe 13 typefaces ship with the code, so a render is the same everywhere');
  const fonts = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith('.ttf')) : [];
  ok(fonts.length === 13, `${fonts.length} font files vendored`);
  const families = new Set(Object.values(styles).map((s) => s.fontName));
  const flat = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const unmatched = [...families].filter((f) => !fonts.some((file) => flat(file).startsWith(flat(f))));
  ok(unmatched.length === 0, `every family a preset names has a file${unmatched.length ? `: missing ${unmatched}` : ''}`);
  ok(fs.readdirSync(FONTS).some((f) => /licen[cs]e/i.test(f)),
    'with the licences they were released under');

  // --- the part that only a real burn can answer -----------------------------
  //
  // A preset whose ASS parses but paints nothing looks exactly like a detector
  // finding nothing, or a template the client did not like. It has to be burned.
  let ffmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

  if (!ffmpeg) {
    console.log('\n  SKIP ffmpeg is not on this machine, so the burn was not run');
  } else {
    console.log('\nEvery preset burns, and puts ink on the frame');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'));
    const bad = [];
    const seen = new Map();
    for (const [id, preset] of Object.entries(styles)) {
      const assPath = path.join(tmp, `${id}.ass`);
      fs.writeFileSync(assPath, m.compile({ words: WORDS, preset, format: vertical }));
      const png = path.join(tmp, `${id}.png`);
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
          '-i', `color=c=0x101010:s=${vertical.width}x${vertical.height}:d=2:r=25`,
          '-vf', `subtitles=${assPath}:fontsdir=${FONTS}`,
          '-ss', '1.4', '-frames:v', '1', png], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { bad.push(`${id}: ${String(e.stderr || e.message).slice(0, 80)}`); continue; }
      // A frame of flat background compresses to almost nothing. Text on it does
      // not, so the file size is a crude but honest "something was drawn".
      if (!fs.existsSync(png) || fs.statSync(png).size < 3000) { bad.push(`${id}: blank frame`); continue; }
      seen.set(id, crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex'));
    }
    ok(bad.length === 0, `all ${Object.keys(styles).length} presets drew something${bad.length ? `\n      ${bad.join('\n      ')}` : ''}`);

    // Ink on the frame is not enough on its own. libass answers a malformed
    // style line by falling back to its own default and drawing the text
    // anyway, which passes the check above while every template renders
    // identically. Distinctness is the assertion that catches that: if the
    // style row stops being applied, all 27 collapse onto the same frame.
    const byHash = new Map();
    for (const [id, h] of seen) byHash.set(h, [...(byHash.get(h) || []), id]);
    const collisions = [...byHash.values()].filter((ids) => ids.length > 1);
    ok(seen.size === Object.keys(styles).length && collisions.length === 0,
      `all ${seen.size} render differently from each other`
      + (collisions.length ? `: ${collisions.map((c) => c.join(' = ')).join(', ')}` : ''));

    // Distinctness alone does not prove the TYPEFACE reached libass, because
    // the colours would keep the frames apart on their own. These two render
    // the same preset with only the font changed, and only the size changed.
    const burn = (preset, tag) => {
      const a = path.join(tmp, `${tag}.ass`);
      fs.writeFileSync(a, m.compile({ words: WORDS, preset, format: vertical }));
      const png = path.join(tmp, `${tag}.png`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=0x101010:s=${vertical.width}x${vertical.height}:d=2:r=25`,
        '-vf', `subtitles=${a}:fontsdir=${FONTS}`, '-ss', '1.4', '-frames:v', '1', png],
      { stdio: ['ignore', 'pipe', 'pipe'] });
      return crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex');
    };
    const ref = styles.minimal || Object.values(styles)[0];
    console.log('\nThe typeface and the size reach the renderer, not only the colours');
    ok(burn(ref, 'font-a') !== burn({ ...ref, fontName: 'Bangers' }, 'font-b'),
      'changing only the font changes the frame');
    ok(burn(ref, 'size-a') !== burn({ ...ref, fontSize: ref.fontSize * 2 }, 'size-b'),
      'changing only the size changes the frame');

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- the client's kit --------------------------------------------------------
  const svc = require('../src/services/captions');

  console.log('\nThe library is exposed without leaking the whole config');
  const list = svc.templates();
  ok(list.length === Object.keys(styles).length
    && list.every((t) => t.id && t.name && t.swatch?.accent),
    'every row carries what the picker paints from, so the list needs no renders');
  ok(!('fontSize' in list[0]) && !('outlineSize' in list[0]),
    'and not the fields only the compiler needs');

  console.log('\nA brand kit is built from the assets the client already has');
  const assets = [
    { kind: 'font', name: 'Suisse Int\'l', metadata: { role: 'heading' } },
    { kind: 'font', name: 'Ignore Me', metadata: { role: 'body' } },
    { kind: 'palette', metadata: { colors: ['#F7F4EF', '#2B2B2B', '#C8701E'] } },
  ];
  const kit = svc.kitFromAssets(assets);
  ok(kit.font === "Suisse Int'l", 'the heading face wins over the body face');
  ok(kit.accent === '#C8701E', 'and the accent is the most saturated colour, not the first');
  ok(!kit.ink, 'the body colour is NOT taken from the palette');

  console.log('\nAn unreadable accent is dropped rather than shipped');
  // Captions sit over ungraded footage. A near-black brand colour as the accent
  // is a word that vanishes into its own outline, which is worse than using the
  // template's own.
  const dark = svc.kitFromAssets([{ kind: 'palette', metadata: { colors: ['#0B0B0B', '#111111'] } }]);
  ok(!dark.accent && dark.rejected_accent, 'it is rejected, and the panel is told which one');
  ok(svc._internals.contrast('#FFFFFF', '#000000') > 20, 'white on black is the top of the scale');
  ok(svc._internals.contrast('#0B0B0B', '#000000') < 2.2, 'near-black on black is the bottom');

  console.log('\nBad input does not produce a broken kit');
  ok(Object.keys(svc.kitFromAssets([])).length === 0, 'no assets, no kit, no throw');
  ok(Object.keys(svc.kitFromAssets(null)).length === 0, 'null does not throw either');
  ok(!svc.kitFromAssets([{ kind: 'palette', metadata: { colors: ['nonsense', ''] } }]).accent,
    'a palette of junk yields no accent');

  // --- the sample gallery ------------------------------------------------------
  //
  // A swatch says what a template's colours are. It cannot say whether the
  // caption clears the speaker's face or holds up over a bright shot, which is
  // what an operator is choosing on. These check the machinery around that:
  // mostly the cache, because a cache that serves a stale example is a gallery
  // that quietly describes footage nobody uses any more.
  if (ffmpeg) {
    console.log('\nThe sample gallery renders over one clip and caches the result');
    const sampleTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-'));
    const stand = path.join(sampleTmp, 'stand.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'gradients=s=540x960:d=4:speed=0.1:n=3:r=25', '-t', '4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', stand], { stdio: 'ignore' });

    const had = svc.houseClip();
    const keep = had ? fs.readFileSync(had) : null;
    try {
      await svc.setHouseClip(stand);
      ok(!!svc.houseClip(), 'an uploaded clip becomes the house clip');

      const a = await svc.sampleClip({ templateId: 'nordic-clean' });
      ok(fs.existsSync(a) && fs.statSync(a).size > 5000, 'and a template renders over it');

      const again = await svc.sampleClip({ templateId: 'nordic-clean' });
      ok(again === a, 'a second request is served from the cache, not re-rendered');

      const skinned = await svc.sampleClip({ templateId: 'nordic-clean', kit: { accent: '#C8701E' } });
      ok(skinned !== a, 'a client kit gets its own file rather than colliding with the house one');
      ok(fs.statSync(skinned).size > 5000, 'and it renders too');

      // The one that rots in silence. Without the clip in the key, replacing
      // the footage leaves every example showing the old clip until somebody
      // empties the folder by hand, and nobody thinks to.
      const countBefore = fs.readdirSync(svc.CACHE_DIR).length;
      await svc.setHouseClip(stand);
      ok(countBefore > 0 && fs.readdirSync(svc.CACHE_DIR).length === 0,
        'replacing the clip empties the cache');
      const c = await svc.sampleClip({ templateId: 'nordic-clean' });
      ok(c !== a, 'and the new example is a different file from the old one');

      // The normalised house clip has no audio, so transcribing IT would always
      // come back empty. The upload transcribes the original instead, and the
      // fallback has to say which problem it hit rather than reporting silence.
      let noAudio = null;
      try { await svc.transcribeHouseClip(); } catch (e) { noAudio = e.message; }
      ok(/no audio track|OpenAI key/.test(noAudio || ''),
        `transcribing the stripped clip fails loudly: ${noAudio}`);

      let refused = null;
      try { await svc.sampleClip({ templateId: 'not-a-template' }); }
      catch (e) { refused = e.message; }
      ok(/not-a-template/.test(refused || ''),
        'an unknown template is refused by name rather than rendering nothing');
    } finally {
      svc.clearSampleCache();
      if (keep) fs.writeFileSync(svc.houseClip() || path.join(svc.SAMPLES_DIR, 'house.mp4'), keep);
      else { const h = path.join(svc.SAMPLES_DIR, 'house.mp4'); fs.existsSync(h) && fs.unlinkSync(h); }
      fs.rmSync(sampleTmp, { recursive: true, force: true });
    }
  }

  // --- the presets measured from October's own reference reels ----------------
  //
  // These were not ported. Each came off the pixels of a reel October chose:
  // box opacity read against the background behind it, glyph height in pixels
  // scaled to 1920, colour sampled directly. What they have in common is the
  // thing the ported library does not do at all — a phrase at a time, with no
  // word-level animation, at roughly a third the type size.
  console.log('\nThe measured presets behave unlike the ported ones, which is the point');
  const measured = Object.values(styles).filter((x) => x.category === 'measured');
  ok(measured.length === 4, `${measured.length} measured presets`);
  ok(measured.every((x) => x.wordsPerLine >= 6),
    'every one captions a phrase, not a word');
  ok(measured.every((x) => x.fontSize <= 46) && Object.values(styles)
    .filter((x) => x.category !== 'measured').every((x) => x.fontSize >= 90),
    'and sets type at roughly a third the size of a creator template');
  ok(measured.every((x) => x.measuredFrom),
    'each records which reel it came from, so a wrong number can be traced');

  console.log('\nA translucent box is possible, and is what the reels actually use');
  const boxed = styles.institution;
  const withBox = m.compile({ words: WORDS, preset: boxed, format: vertical });
  const styleLine = withBox.split('\n').find((l) => l.startsWith('Style: '));
  // 65% opaque black is alpha 89 in ASS, which counts transparency, not opacity.
  ok(/&H59000000/.test(styleLine),
    'the box alpha reaches the style line as ASS transparency');
  const solid = m.compile({ words: WORDS, preset: { ...boxed, boxAlpha: 1 }, format: vertical });
  ok(/&H00000000/.test(solid.split('\n').find((l) => l.startsWith('Style: '))),
    'and a fully opaque box is still available');

  console.log('\nA phrase caption wraps; a word-at-a-time one never does');
  ok(/WrapStyle: 0/.test(withBox), 'phrase templates wrap onto a second line');
  ok(/WrapStyle: 2/.test(m.compile({ words: WORDS, preset: styles.hormozi, format: vertical })),
    'word templates do not, because three short words never need to');
  // Without this the measured presets ran a seven-word caption edge to edge at
  // 36px, which is a size nobody reads and not what any of the reels do.
  const marginOf = (ass) => Number(ass.split('\n').find((l) => l.startsWith('Style: ')).split(',')[19]);
  ok(marginOf(withBox) > marginOf(m.compile({ words: WORDS, preset: styles.hormozi, format: vertical })),
    'and they are held further in from the edges so the break happens');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('  FAIL ', e.stack || e.message); process.exit(1); });

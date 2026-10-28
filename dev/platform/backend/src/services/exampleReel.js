/**
 * One finished reel, always there, so what the studio does is visible before
 * anybody commits footage to it.
 *
 * The caption gallery already shows what each template does to moving footage.
 * What it cannot show is the finished thing: a clip that has been captioned,
 * had its dead air taken out and had a cutaway laid in. That is the output, and
 * an operator who has never seen it has to take the tab names on trust.
 *
 * Built from the same house sample clip the caption examples use, rendered once
 * and cached, exactly like them. Nothing here is per client: a generic example
 * is unmistakably a demonstration, where one made from a client's own footage
 * would sit in their library looking like work somebody ordered.
 *
 * One honest compromise, stated on screen rather than hidden here. There is
 * only one sample clip, so the cutaway is a punch-in on the same footage rather
 * than separate b-roll. A punch-in is a real technique and it demonstrates the
 * mechanism truthfully: the picture changes while the speaker keeps talking.
 * What it does not show is choosing from a library, because the example has no
 * library to choose from.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const captions = require('./captions');
const brollRender = require('./brollRender');

const SHARED = path.join(__dirname, '..', '..', '..', 'shared');
const CACHE_DIR = path.join(__dirname, '..', '..', 'video-samples', 'cache');

/** The template a single example is cut with, when only one is asked for. */
const TEMPLATE = 'institution';

/**
 * The styles shown side by side, so what is possible is visible at a glance
 * rather than inferred from a list of thirty-one names.
 *
 * Four of October's own measured presets and two creator ones. The creator
 * pair is not padding: the whole argument for the measured presets is that
 * they look different from what everybody else posts, and that argument is
 * unreadable without something to compare against.
 */
const STYLES = ['institution', 'institution-soft', 'gallery', 'gallery-quiet',
  'hormozi', 'karaoke'];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-500)}`));
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Cache key, from the things that change the output.
 *
 * The house clip's modification time is in it, so replacing the sample clip
 * retires the example rather than leaving an old render on screen describing
 * footage nobody uses any more.
 */
function cacheKey(source, templateId) {
  const stat = fs.statSync(source);
  return crypto.createHash('sha1')
    .update(`${templateId}|${stat.mtimeMs}|${stat.size}|v1`)
    .digest('hex').slice(0, 12);
}

/** What was done to it, for the line under the player. */
function describe(steps) {
  return steps;
}

/**
 * Build the example, or hand back the one already built.
 *
 * Returns the path and what each step did, so the screen can say what it is
 * looking at rather than show a video and leave the viewer to guess.
 */
async function build({ templateId = TEMPLATE, source: sourceIn = null,
  words: wordsIn = null, cacheDir = CACHE_DIR } = {}) {
  // The source and its transcript are overridable so the whole path can be
  // tested against a clip long enough to demonstrate every step. The house
  // clip is four seconds, which is right for a caption swatch and far too
  // short for a worked example, so without this seam the only code paths a
  // test could reach would be the ones that refuse.
  const source = sourceIn || captions.houseClip();
  if (!source) {
    const e = new Error('No sample clip yet. Upload one under Produce to build the example.');
    e.status = 409;
    throw e;
  }
  // Fail fast rather than fail correctly: captions.burn refuses an unknown
  // template too, but only after the tighten and the cutaway have already been
  // rendered and paid for. This is the cheap refusal, not the guard.
  captions.preset(templateId);

  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `example-${cacheKey(source, templateId)}.mp4`);
  const meta = `${out}.json`;
  if (fs.existsSync(out) && fs.statSync(out).size > 1000 && fs.existsSync(meta)) {
    return { path: out, ...JSON.parse(fs.readFileSync(meta, 'utf8')), cached: true };
  }

  // The real transcript when the clip has one. The nine canned words are a
  // fallback for the caption swatches and describe footage this example is not
  // using, so they are not borrowed here: an example captioned with somebody
  // else's sentence is worse than one with no captions.
  const words = wordsIn || captions.houseWords() || [];
  const [{ planCuts }, { planBroll }] = await Promise.all([
    import(pathToFileURL(path.join(SHARED, 'silenceCut.mjs')).href),
    import(pathToFileURL(path.join(SHARED, 'brollPlan.mjs')).href),
  ]);

  const probe = await brollRender.probe(source);
  const steps = [];
  // What the sample clip was too short or too quiet to demonstrate. An example
  // that silently leaves out a step teaches that the step does not exist, and
  // the cutaway is both the newest capability and the least obvious one.
  const missing = [];
  const work = `${out}.work`;
  // Clear anything an interrupted build left here. The directory is named
  // after the output, so a retry of the same key would otherwise start on top
  // of half-written intermediates from a render that was killed.
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  try {
    // 1. Tighten. The same planner the Produce panel runs, on the same words.
    let current = source;
    const cut = planCuts(words, { media_s: probe.duration });
    if (!words.length) {
      missing.push('Pauses and fillers removed: the sample clip has not been transcribed, '
        + 'so there are no word timings to cut on. Transcribe it under Produce.');
    }
    if (cut.cuts.length && cut.new_s > 1) {
      const tightened = path.join(work, 'tightened.mp4');
      const silenceCut = require('./silenceCut');
      await silenceCut.apply({ source, keep: cut.keep, outPath: tightened });
      current = tightened;
      steps.push(`${cut.cuts.length} pause${cut.cuts.length === 1 ? '' : 's'} and filler`
        + `${cut.cuts.length === 1 ? '' : 's'} removed, ${cut.saved_s}s shorter`);
    } else if (words.length) {
      // Nothing to cut is a property of the footage, not of the tool, and the
      // example should not imply the step does not exist because this
      // particular take happened to be clean.
      missing.push('Pauses and fillers removed: there are none in the sample clip worth '
        + 'cutting, so this example has nothing to show for that step.');
    }

    // 2. A cutaway. A punch-in on the same footage, because there is one clip.
    const after = await brollRender.probe(current);
    const plan = planBroll(words, { media_s: after.duration, limit: 1 });
    if (plan.spans.length) {
      const span = plan.spans[0];
      const punch = path.join(work, 'punch.mp4');
      const W = probe.width || 1080;
      const H = probe.height || 1920;
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(span.from), '-i', current,
        '-t', String(Math.max(0.8, span.to - span.from)),
        '-vf', `scale=${Math.round(W * 1.35 / 2) * 2}:${Math.round(H * 1.35 / 2) * 2},`
          + `crop=${W}:${H},setsar=1`,
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', punch]);

      const withCut = path.join(work, 'cutaway.mp4');
      const laid = await brollRender.overlay({ source: current,
        placements: [{ from: span.from, to: span.to, file: punch }], outPath: withCut });
      current = laid.outPath;
      steps.push(`a cutaway at ${span.from}s, because ${span.reason[0].toLowerCase()}${span.reason.slice(1)}`);
    } else {
      missing.push(`A cutaway: the sample clip runs ${after.duration.toFixed(1)}s, and the `
        + 'planner keeps the opening and the ending on the speaker, so there is no room '
        + 'in between. Replace the sample with twenty seconds or more of someone talking '
        + 'and the example will show one.');
    }

    // 3. Captions, last, so they are burned over the finished picture. This is
    // the only step that differs between styles, which is why the cut above is
    // rendered once and reused: six styles are six caption burns, not six
    // whole edits.
    const captioned = path.join(work, 'captioned.mp4');
    if (words.length) {
      await captions.burn({ words, templateId, kit: null,
        formatId: 'vertical', source: current, outPath: captioned });
      steps.push(`captions in the ${captions.preset(templateId).name} template`);
    } else {
      fs.copyFileSync(current, captioned);
      missing.push(`Captions in the ${captions.preset(templateId).name} template: `
        + 'the sample clip has no transcript to caption from.');
    }

    fs.copyFileSync(captioned, out);
    const final = await brollRender.probe(out);
    const info = { steps: describe(steps), missing, seconds: +final.duration.toFixed(2),
      template: templateId, template_name: captions.preset(templateId).name,
      // Said on screen rather than buried here: there is one sample clip, so
      // the cutaway cannot come from a second source.
      note: 'Cut from the house sample clip. Any cutaway here is a punch-in on the same '
        + 'footage, because the example has no second clip to draw on; in your own reels '
        + 'you pick from the client\'s library.' };
    fs.writeFileSync(meta, JSON.stringify(info));
    return { path: out, ...info, cached: false };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Whether an example can be built at all, without building it. */
function status() {
  const clip = captions.houseClip();
  return {
    available: !!clip,
    template: TEMPLATE,
    reason: clip ? null : 'No sample clip has been uploaded yet.',
  };
}

/**
 * The same reel in several styles, for comparison.
 *
 * Each style is a separate file because a browser can play six small videos
 * side by side and cannot play one video six ways. They share everything
 * except the caption burn, and each is cached on its own, so adding a style
 * costs one burn rather than one edit.
 *
 * Built lazily, one at a time, and a style that fails does not take the rest
 * with it: a comparison missing one row is worth more than an error page.
 */
async function buildSet({ templates = STYLES, lazy = false, ...rest } = {}) {
  const out = [];
  let shared = null;
  // Lazily, the first style is built and the rest are only named. Each video
  // element then fetches its own and builds it on demand, so the grid appears
  // in the time of one render rather than six. On a cold cache that is the
  // difference between twenty seconds and a minute and a half of blank panel,
  // and a panel that shows nothing for ninety seconds reads as broken.
  const toBuild = lazy ? templates.slice(0, 1) : templates;
  for (const templateId of templates) {
    if (!toBuild.includes(templateId)) {
      out.push({ template: templateId, name: captions.preset(templateId).name, pending: true });
      continue;
    }
    try {
      // The source, transcript and cache directory pass straight through, so a
      // caller testing this against a clip long enough to carry every step
      // reaches the same code the house clip does.
      const r = await build({ templateId, ...rest });
      if (!shared) {
        shared = { seconds: r.seconds, missing: r.missing, note: r.note,
          // The steps every style shares, which is everything except its own
          // caption line.
          steps: r.steps.filter((s) => !/^captions in the/.test(s)) };
      }
      out.push({ template: templateId, name: r.template_name, seconds: r.seconds,
        captioned: r.steps.some((s) => /^captions in the/.test(s)) });
    } catch (err) {
      console.error(`[example] ${templateId} failed:`, err.message);
      out.push({ template: templateId, error: err.message });
    }
  }
  return { styles: out, ...(shared || { steps: [], missing: [], note: null }) };
}

module.exports = { build, buildSet, status, TEMPLATE, STYLES, CACHE_DIR };

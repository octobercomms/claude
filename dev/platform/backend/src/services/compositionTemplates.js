/**
 * The shipped video templates, read from `shared/templates/`.
 *
 * A template is data, not code: eight JSON files that `bindTemplate` turns
 * into a Composition. That is deliberate. Daniel's requirement was five to ten
 * preloaded shapes he does not have to build, and the way those stay
 * maintainable is that adding a ninth means adding a file, not editing a
 * module. The cost of data is that nothing compiles it, so this loader
 * VALIDATES on read and refuses to serve a broken one rather than letting it
 * reach a batch of thirty.
 *
 * Read once and cached. The files ship with the deploy and cannot change
 * under a running process, and a batch binding thirty videos would otherwise
 * re-read and re-validate eight files thirty times.
 */

const fs = require('fs');
const path = require('path');

const { validateTemplate } = require('../../../shared/compositionTemplate.mjs');

const DIR = path.join(__dirname, '..', '..', '..', 'shared', 'templates');

let cache = null;

function load() {
  if (cache) return cache;

  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  const ok = [];
  const broken = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    } catch (err) {
      broken.push({ file, errors: [`not valid JSON: ${err.message}`] });
      continue;
    }
    const errors = validateTemplate(parsed);
    if (errors.length) broken.push({ file, errors });
    else ok.push(parsed);
  }

  // Loud, and loud at startup rather than at the moment somebody runs a
  // batch. A template that does not validate cannot be bound, so serving it
  // would only move the failure to a worse place.
  if (broken.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[templates] ${broken.length} template file(s) are invalid and will not be offered:\n`
      + broken.map((b) => `  ${b.file}: ${b.errors.join('; ')}`).join('\n')
    );
  }

  cache = { templates: ok, broken };
  return cache;
}

/** Every valid shipped template, whole, for binding. */
function all() {
  return load().templates;
}

/** One template by id, or null. */
function byId(id) {
  if (!id) return null;
  return load().templates.find((t) => t.id === id) || null;
}

/**
 * What the picker needs and nothing else.
 *
 * The slots are summarised rather than sent whole, because the question the
 * picker answers is "what do I have to supply" — six to eight photographs and
 * a piece of music — and that is a count per kind, not a slot array.
 */
function list() {
  return load().templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    bestFor: t.bestFor,
    register: t.register,
    size: t.size,
    fps: t.fps,
    captionPreset: t.caption?.preset || null,
    needs: t.slots
      .filter((s) => (s.min ?? 1) > 0)
      .map((s) => ({ slot: s.id, kind: s.kind, min: s.min ?? 1, max: s.max ?? s.min ?? 1 })),
    optional: t.slots
      .filter((s) => (s.min ?? 1) === 0)
      .map((s) => ({ slot: s.id, kind: s.kind, max: s.max ?? 1 })),
  }));
}

/** The files that failed validation, so a health check can surface them. */
function problems() {
  return load().broken;
}

/** Testing only: drop the cache so a fixture directory can be re-read. */
function reset() {
  cache = null;
}

module.exports = {
  all, byId, list, problems, reset,
};

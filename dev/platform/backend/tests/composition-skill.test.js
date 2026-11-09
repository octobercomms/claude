/**
 * The agent skill for authoring a Composition, checked against the code.
 *
 * `.claude/skills/omi-composition/SKILL.md` is prose, and prose is the one
 * thing in this repo nothing compiles. The eight shipped templates have a
 * test for exactly this reason — a field renamed in the module leaves eight
 * JSON files quietly declaring the old one — and a skill is worse, because an
 * agent reads it and believes it.
 *
 * So three things are asserted:
 *
 *   1. Every worked example validates AND builds a graph. An example that
 *      does not render is a lesson in how to break a render.
 *   2. Every identifier and every file path the skill names exists. A renamed
 *      export breaks the skill, and this is what notices.
 *   3. Every field the validator reads is documented, and every field the
 *      skill documents is accepted. Add `item.blur` to the model and this
 *      fails until the skill says what it does.
 *
 *   node tests/composition-skill.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validate, TRANSITION_TYPES, TRANSFORM_FIELDS, RATIONALE_FIELDS } =
  require('../../shared/composition.mjs');
const { renderGraph } = require('../../shared/compositionRender.mjs');
const { FX_NAMES } = require('../../shared/compositionFx.mjs');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const SKILL_DIR = path.join(ROOT, '.claude', 'skills', 'omi-composition');
const SKILL = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const ASSETS = path.join(SKILL_DIR, 'assets');
const SHARED = path.join(__dirname, '..', '..', 'shared');
const MODEL = fs.readFileSync(path.join(SHARED, 'composition.mjs'), 'utf8');

// ── the frontmatter ───────────────────────────────────────────────────

describe('the skill itself', () => {
  it('has the frontmatter the loader reads', () => {
    assert.match(SKILL, /^---\nname: omi-composition\n/);
    assert.match(SKILL, /\ndescription: /);
    assert.match(SKILL, /\nmetadata:\n  version: \d+\.\d+\.\d+\n/);
  });

  it('says when to reach for it, in the words a render actually answers', () => {
    // A description is how the skill gets found at all. These three strings
    // are the errors a broken composition produces, and somebody pasting one
    // into a prompt should land here.
    const description = SKILL.split('---')[1];
    for (const phrase of ['has no file on disk', 'matches no streams', 'black']) {
      assert.ok(description.includes(phrase), `the description mentions "${phrase}"`);
    }
  });
});

// ── the worked examples ───────────────────────────────────────────────

describe('the worked examples', () => {
  const FILES = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.json')).sort();

  it('ships four', () => {
    assert.equal(FILES.length, 4, `found ${FILES.join(', ')}`);
  });

  for (const file of FILES) {
    const comp = JSON.parse(fs.readFileSync(path.join(ASSETS, file), 'utf8'));

    describe(file, () => {
      it('is named in the skill, so nothing ships unexplained', () => {
        assert.ok(SKILL.includes(file), `${file} is not mentioned in SKILL.md`);
      });

      it('validates', () => {
        assert.deepEqual(validate(comp), []);
      });

      it('builds a graph, which is where the invariants bite', () => {
        // Validating is not rendering. Captions as an input, a still with no
        // audio stream and an fx source with no file all pass `validate` and
        // fail here, which is why an example that only validated would be
        // teaching the wrong thing.
        const needsCaptions = Object.values(comp.sources)
          .some((s) => s.kind === 'captions');
        const graph = renderGraph(comp, {
          captionAssPath: needsCaptions ? '/tmp/example.ass' : null,
        });
        assert.ok(graph.inputs.length > 0, 'it has inputs');
        assert.ok(graph.graph.length > 0, 'and a filter graph');
        assert.equal(graph.needsCaptions, needsCaptions);
      });

      it('gives no ffmpeg input to a caption or an fx source', () => {
        const graph = renderGraph(comp, { captionAssPath: '/tmp/example.ass' });
        assert.ok(!graph.inputs.some((i) => i.kind === 'captions'));
        for (const input of graph.inputs) {
          if (input.kind === 'fx') assert.equal(input.generated, true);
        }
      });

      it('explains itself on every item', () => {
        // `reason` is what makes an unattended batch reviewable, and an
        // example without one teaches that it is optional decoration.
        for (const track of comp.tracks) {
          for (const item of track.items) {
            assert.ok(item.reason, `${file}: item ${item.id} has no reason`);
          }
        }
      });
    });
  }

  it('between them, cover every source kind the skill documents', () => {
    const used = new Set();
    for (const file of FILES) {
      const comp = JSON.parse(fs.readFileSync(path.join(ASSETS, file), 'utf8'));
      for (const src of Object.values(comp.sources)) used.add(src.kind);
    }
    // `design` is the one left out, and deliberately: it needs a design
    // project id that only exists in a database, so an example of it could
    // not be rendered by anything reading this file.
    assert.deepEqual([...used].sort(), ['audio', 'captions', 'clip', 'fx']);
  });

  it('shows the one-source-many-placements rule rather than only stating it', () => {
    const comp = JSON.parse(fs.readFileSync(path.join(ASSETS, 'stills-with-type.json'), 'utf8'));
    const captionSources = Object.entries(comp.sources).filter(([, s]) => s.kind === 'captions');
    assert.equal(captionSources.length, 1);
    const placements = comp.tracks
      .flatMap((t) => t.items)
      .filter((i) => i.source === captionSources[0][0]);
    assert.ok(placements.length > 1, 'two titles out of one source');
  });
});

// ── what the skill names ──────────────────────────────────────────────

describe('everything the skill names exists', () => {
  it('names only files that are there', () => {
    // A renamed module leaves a skill pointing at nothing, and an agent
    // following it opens a file that does not exist and invents the rest.
    const paths = [...SKILL.matchAll(/`((?:dev\/platform\/|backend\/|frontend\/|shared\/)?[\w./-]+\.(?:mjs|js|jsx|json|md))`/g)]
      .map((m) => m[1]);
    assert.ok(paths.length > 8, `found ${paths.length} paths to check`);
    const missing = [];
    for (const p of paths) {
      const candidates = [
        path.join(ROOT, p),
        path.join(ROOT, 'dev', 'platform', p),
        path.join(SHARED, p),
        path.join(SHARED, 'captions', path.basename(p)),
        path.join(SHARED, 'templates', path.basename(p)),
        path.join(__dirname, path.basename(p)),
        path.join(ASSETS, path.basename(p)),
      ];
      if (!candidates.some((c) => fs.existsSync(c))) missing.push(p);
    }
    assert.deepEqual(missing, [], `the skill points at files that are not there`);
  });

  it('names only exports that are there', () => {
    const names = [
      'validate', 'renderGraph', 'ffmpegArgs', 'bindTemplate', 'validateTemplate',
      'SOURCE_KINDS', 'PICTURE_KINDS', 'TRANSITION_TYPES', 'FX_NAMES', 'MOTION_NAMES',
    ];
    for (const name of names) {
      assert.ok(SKILL.includes(name), `the skill is expected to name ${name}`);
    }
    const sources = ['composition.mjs', 'compositionRender.mjs', 'compositionTemplate.mjs', 'compositionFx.mjs']
      .map((f) => fs.readFileSync(path.join(SHARED, f), 'utf8'))
      .join('\n');
    for (const name of names) {
      assert.ok(
        new RegExp(`(export (const|function) |function |const )${name}\\b`).test(sources),
        `the skill names ${name}, which no shared module declares`
      );
    }
    assert.ok(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'compositionRenderer.js'), 'utf8')
        .includes('function buildCaptionAss'),
      'the skill names buildCaptionAss, which compositionRenderer no longer has'
    );
  });

  it('documents every effect that ships', () => {
    // Three today. A fourth that nobody documents is a fourth nobody uses.
    for (const name of FX_NAMES) {
      assert.ok(SKILL.includes(`\`${name}\``), `the skill names the ${name} effect`);
    }
  });
});

// ── the field tables ──────────────────────────────────────────────────

/** Every `item.<field>` the model's validator reads. */
function fieldsRead(prefix) {
  const found = new Set();
  for (const m of MODEL.matchAll(new RegExp(`\\b${prefix}\\.([a-zA-Z]+)`, 'g'))) {
    found.add(m[1]);
  }
  return found;
}

describe('the field tables match the validator', () => {
  // Fields the validator touches that are not user-facing input: identity,
  // structure, and the two it reads off a source rather than checks.
  const NOT_DOCUMENTED = new Set(['id', 'items', 'kind', 'length', 'map', 'filter', 'push', 'source']);

  it('documents every item field the validator checks', () => {
    // THE ANTI-ROT DIRECTION THAT MATTERS. Add a field to `validateItem` and
    // this fails until the skill says what it does, which is the only way a
    // document like this stays true.
    const undocumented = [...fieldsRead('item')]
      .filter((f) => !NOT_DOCUMENTED.has(f))
      .filter((f) => !SKILL.includes(`\`${f}\``));
    assert.deepEqual(undocumented, [], 'item fields the skill does not mention');
  });

  it('documents every source field the validator checks', () => {
    const undocumented = [...fieldsRead('src')]
      .filter((f) => !NOT_DOCUMENTED.has(f))
      .filter((f) => !SKILL.includes(`\`${f}\``));
    assert.deepEqual(undocumented, [], 'source fields the skill does not mention');
  });

  it('documents every transform and rationale field', () => {
    for (const f of [...TRANSFORM_FIELDS, ...RATIONALE_FIELDS]) {
      assert.ok(SKILL.includes(`\`${f}\``), `the skill documents \`${f}\``);
    }
  });

  it('accepts every item field it documents', () => {
    // The other direction: a field in the table that the validator refuses
    // would be an agent writing a composition that cannot be saved.
    const base = () => ({
      version: 1,
      size: { width: 1080, height: 1920 },
      fps: 30,
      sources: {
        a: { kind: 'clip', url: 'a.mp4', duration: 20 },
        m: { kind: 'audio', url: 'm.mp3', duration: 60 },
      },
      tracks: [
        { id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 4, source: 'a' }] },
        { id: 't1', kind: 'audio', items: [{ id: 'm1', at: 0, len: 4, source: 'm' }] },
      ],
    });
    const cases = {
      in: 2,
      fit: 'cover',
      opacity: 0.5,
      trans: { type: TRANSITION_TYPES[0] },
      scale: { from: 1, to: 1.1 },
      pos: { x: 0.1, y: -0.1 },
      reason: 'because',
      beat: 'push-in',
      quote: 'a line of the brief',
    };
    for (const [field, value] of Object.entries(cases)) {
      const comp = base();
      comp.tracks[0].items[0][field] = value;
      assert.deepEqual(validate(comp), [], `\`${field}\` is documented but refused`);
    }
    // `gain` belongs to the audio item, which is where the skill says it.
    const withGain = base();
    withGain.tracks[1].items[0].gain = 2;
    assert.deepEqual(validate(withGain), []);
  });
});

// ── the invariants are the point ───────────────────────────────────────

describe('the invariants it states are the ones the code enforces', () => {
  const comp = () => ({
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      a: { kind: 'clip', url: 'a.mp4', duration: 20 },
      m: { kind: 'audio', url: 'm.mp3', duration: 60 },
    },
    tracks: [
      { id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 4, source: 'a' }] },
      { id: 't1', kind: 'audio', items: [{ id: 'm1', at: 0, len: 4, source: 'm' }] },
    ],
  });

  it('a picture on an audio track is refused, as it says', () => {
    const c = comp();
    c.tracks[1].items.push({ id: 'x', at: 0, len: 2, source: 'a' });
    assert.match(validate(c).join(' '), /clip source on an audio track/);
  });

  it('an audio source on a video track is refused, as it says', () => {
    const c = comp();
    c.tracks[0].items.push({ id: 'x', at: 6, len: 2, source: 'm' });
    assert.match(validate(c).join(' '), /audio source on a video track/);
  });

  it('a caption source needs a transcript, as it says', () => {
    const c = comp();
    c.sources.w = { kind: 'captions' };
    assert.match(validate(c).join(' '), /captions needs a transcript/);
  });

  it('an fx source needs an effect the catalogue has, as it says', () => {
    const c = comp();
    c.sources.f = { kind: 'fx' };
    assert.match(validate(c).join(' '), /fx needs an effect name/);
    c.sources.f = { kind: 'fx', effect: 'glow' };
    c.tracks[0].items.push({ id: 'f1', at: 0, len: 4, source: 'f' });
    assert.deepEqual(validate(c), [], 'the model accepts any name');
    assert.throws(() => renderGraph(c), /unknown effect "glow"/, 'and the renderer refuses it');
  });

  it('version 1 is the only version, as it says', () => {
    const c = comp();
    c.version = 2;
    assert.match(validate(c).join(' '), /unknown version 2/);
  });

  it('rot validates and then refuses to render, as it says', () => {
    // The first version of the skill said "validated and never drawn", which
    // implied it renders without the rotation. It does not: the graph throws.
    // Caught by this test, which is the whole reason it exists.
    const c = comp();
    c.tracks[0].items[0].rot = 10;
    assert.deepEqual(validate(c), [], 'the model accepts it');
    assert.throws(() => renderGraph(c), /cannot draw yet/, 'and the renderer refuses the graph');
  });
});

// ── the published schema ──────────────────────────────────────────────

describe('the generated JSON Schema', () => {
  const { buildSchema, schemaText } = require('../../shared/compositionSchema.mjs');
  const FILE = path.join(SHARED, 'composition.schema.json');
  const committed = fs.readFileSync(FILE, 'utf8');

  it('matches the committed file byte for byte', () => {
    // THE WHOLE POINT. The schema is built from the model's own vocabularies
    // and bounds, so changing one and not regenerating fails here. A
    // committed schema that has drifted from the model is worse than no
    // schema: something reads it and believes it.
    assert.equal(
      committed, schemaText(),
      'shared/composition.schema.json is stale. Regenerate it:\n'
      + "  cd dev/platform/shared && node -e \"import('./compositionSchema.mjs')"
      + '.then(async m => (await import(\'node:fs\')).writeFileSync'
      + "('composition.schema.json', m.schemaText()))\""
    );
  });

  it('takes its vocabularies from the model rather than restating them', () => {
    const schema = buildSchema();
    const model = require('../../shared/composition.mjs');
    assert.deepEqual(schema.$defs.source.properties.kind.enum, model.SOURCE_KINDS);
    assert.deepEqual(schema.$defs.track.properties.kind.enum, model.TRACK_KINDS);
    assert.deepEqual(schema.$defs.item.properties.fit.enum, model.FIT_VALUES);
    assert.deepEqual(schema.$defs.item.properties.trans.properties.type.enum, model.TRANSITION_TYPES);
    assert.equal(schema.properties.version.const, model.COMP_VERSION);
    assert.equal(schema.$defs.item.properties.len.minimum, model.MIN_ITEM);
    assert.equal(schema.$defs.item.properties.reason.maxLength, model.MAX_RATIONALE);
  });

  it('says in its own description what it cannot check', () => {
    // A green tick from a schema is not "this will render". Somebody reading
    // the file rather than the skill has to be told that in the file.
    const schema = buildSchema();
    assert.match(schema.description, /GENERATED/);
    assert.match(schema.description, /do not edit by hand/);
    assert.match(schema.description, /checked by validate\(\)/);
    assert.match(schema.description, /SKILL\.md/);
  });

  it('warns on `rot` where somebody would read it', () => {
    assert.match(buildSchema().$defs.item.properties.rot.description, /RENDERER REFUSES IT/);
  });

  it('accepts every worked example', () => {
    for (const file of fs.readdirSync(ASSETS).filter((f) => f.endsWith('.json'))) {
      const comp = JSON.parse(fs.readFileSync(path.join(ASSETS, file), 'utf8'));
      assert.deepEqual(check(buildSchema(), comp), [], file);
    }
  });

  it('refuses what the model refuses, on the shape at least', () => {
    const base = () => JSON.parse(fs.readFileSync(path.join(ASSETS, 'hard-cut.json'), 'utf8'));
    const schema = buildSchema();

    const wrongVersion = base();
    wrongVersion.version = 2;
    assert.ok(check(schema, wrongVersion).length, 'version 2');

    const unknownKind = base();
    unknownKind.sources.a.kind = 'sticker';
    assert.ok(check(schema, unknownKind).length, 'an unknown source kind');

    const unknownTransition = base();
    unknownTransition.tracks[0].items[1].trans = { type: 'swirl' };
    assert.ok(check(schema, unknownTransition).length, 'an unknown transition');

    const badFit = base();
    badFit.tracks[0].items[0].fit = 'stretch';
    assert.ok(check(schema, badFit).length, 'a fit that is not cover or contain');

    const negativeAt = base();
    negativeAt.tracks[0].items[0].at = -1;
    assert.ok(check(schema, negativeAt).length, 'a negative start');

    const loudGain = base();
    loudGain.tracks[0].items[0].gain = 9;
    assert.ok(check(schema, loudGain).length, 'a gain of 9');

    const noLen = base();
    delete noLen.tracks[0].items[0].len;
    assert.ok(check(schema, noLen).length, 'an item with no length');

    const halfAnimated = base();
    halfAnimated.tracks[0].items[0].scale = { from: 1 };
    assert.ok(check(schema, halfAnimated).length, 'a from with no to');
  });
});

/**
 * A validator for the subset of JSON Schema this repo's generator emits.
 *
 * Written here rather than reached for off the shelf because no JSON Schema
 * validator is a declared dependency of this project, and adding one so a
 * test can run is a lockfile change for a hundred lines of arithmetic. It
 * handles exactly what `buildSchema` produces — type, const, enum, required,
 * properties, additionalProperties, minimum/maximum/exclusiveMinimum,
 * maxLength, oneOf and local $ref — and the test above feeds it eight
 * documents it has to REJECT, so the checker is checked rather than assumed.
 */
function check(schema, value, root = schema, where = '') {
  const errors = [];
  const at = where || 'the document';

  if (schema.$ref) {
    const target = schema.$ref.replace('#/', '').split('/')
      .reduce((o, k) => (o ? o[k] : undefined), root);
    return target ? check(target, value, root, where) : [`${at}: unresolved ${schema.$ref}`];
  }

  if (schema.oneOf) {
    const passed = schema.oneOf.filter((s) => check(s, value, root, where).length === 0);
    if (passed.length !== 1) errors.push(`${at}: matched ${passed.length} of oneOf, wanted 1`);
    return errors;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: "${value}" is not one of ${schema.enum.join(', ')}`);
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${at}: must be a number`);
      return errors;
    }
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${at}: must exceed ${schema.exclusiveMinimum}`);
    }
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(`${at}: must be a string`);
    else if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than ${schema.maxLength}`);
    }
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${at}: must be true or false`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${at}: must be an array`);
      return errors;
    }
    value.forEach((v, i) => errors.push(...check(schema.items || {}, v, root, `${at}[${i}]`)));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${at}: must be an object`);
      return errors;
    }
    for (const name of schema.required || []) {
      if (value[name] === undefined) errors.push(`${at}: missing ${name}`);
    }
    for (const [name, v] of Object.entries(value)) {
      const sub = schema.properties?.[name];
      if (sub) errors.push(...check(sub, v, root, `${at}.${name}`));
      else if (schema.additionalProperties === false) {
        errors.push(`${at}: ${name} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...check(schema.additionalProperties, v, root, `${at}.${name}`));
      }
    }
  }
  return errors;
}

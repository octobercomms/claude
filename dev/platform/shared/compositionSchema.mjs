/**
 * The published JSON Schema for a Composition, BUILT from the model.
 *
 * Every vocabulary and every bound in here is read out of `composition.mjs`
 * at build time rather than typed again. A schema written by hand is a second
 * description of the model, and a second description drifts: add a source
 * kind and the hand-written schema goes on refusing it, while something that
 * reads the schema and believes it rejects a composition the product accepts.
 *
 * `composition.schema.json` is this function's output, committed so a tool
 * that cannot run Node still has it. `composition-skill.test.js` regenerates
 * it and asserts the committed file matches, so it cannot go stale: change a
 * vocabulary and the test fails until the file is written again.
 *
 * ── What a schema can and cannot say ─────────────────────────────────
 *
 * It describes the SHAPE: which fields exist, their types, their ranges, the
 * closed vocabularies. It cannot describe the rules that depend on more than
 * one part of the document at once — a picture on an audio track, a second
 * caption source, an item referencing a source id that is not there, a
 * transition with no overlap behind it. `validate()` is what checks those,
 * and the schema says so in its own description rather than letting a reader
 * assume a green tick means renderable.
 *
 * Pure. No I/O: the caller writes the file.
 */

import {
  COMP_VERSION, SOURCE_KINDS, FIT_VALUES, TRACK_KINDS, TRANSITION_TYPES,
  SCALE_MIN, SCALE_MAX, POS_MIN, POS_MAX, MIN_ITEM, MAX_RATIONALE,
} from './composition.mjs';

/** `{ from, to }` or a plain number, which is how every transform animates. */
function animatable(min, max, description) {
  return {
    description,
    oneOf: [
      { type: 'number', minimum: min, maximum: max },
      {
        type: 'object',
        properties: {
          from: { type: 'number', minimum: min, maximum: max },
          to: { type: 'number', minimum: min, maximum: max },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    ],
  };
}

function animatablePoint(description) {
  const point = {
    type: 'object',
    properties: {
      x: { type: 'number', minimum: POS_MIN, maximum: POS_MAX },
      y: { type: 'number', minimum: POS_MIN, maximum: POS_MAX },
    },
    required: ['x', 'y'],
    additionalProperties: false,
  };
  return {
    description,
    oneOf: [
      point,
      {
        type: 'object',
        properties: { from: point, to: point },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    ],
  };
}

const rationale = { type: 'string', maxLength: MAX_RATIONALE };

export function buildSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://platform.octobercomms.com/schema/composition-v1.json',
    title: 'OMI Composition',
    description:
      'One Composition in, one ffmpeg filter_complex out. The same object drives'
      + ' the browser preview, so what validates here is what the export produces.'
      + ' GENERATED from shared/composition.mjs by shared/compositionSchema.mjs —'
      + ' do not edit by hand. This describes the SHAPE only: the rules that span'
      + ' more than one part of the document (a picture on an audio track, a second'
      + ' caption source, an item referencing a source that is not there, a'
      + ' transition with no overlap behind it) are checked by validate(), and the'
      + ' invariants the renderer enforces beyond that are in'
      + ' .claude/skills/omi-composition/SKILL.md.',
    type: 'object',
    required: ['version', 'size', 'fps', 'sources', 'tracks'],
    additionalProperties: true,
    properties: {
      version: { const: COMP_VERSION, description: 'The only version there is.' },
      size: {
        type: 'object',
        description: 'The frame every fraction in this document is a fraction of.',
        properties: {
          width: { type: 'number', minimum: 1 },
          height: { type: 'number', minimum: 1 },
        },
        required: ['width', 'height'],
        additionalProperties: false,
      },
      fps: { type: 'number', minimum: 1, maximum: 120 },
      ducking: {
        type: 'boolean',
        description:
          'Compress the music under the voice. Needs a source marked voice: true'
          + ' and something else to duck; which is the voice is a property of the'
          + ' source, never of its kind.',
      },
      sources: {
        type: 'object',
        description: 'Keyed by source id, which items reference.',
        additionalProperties: { $ref: '#/$defs/source' },
      },
      tracks: {
        type: 'array',
        description:
          'Composited in array order: track 0 is the base and each later one'
          + ' overlays it.',
        items: { $ref: '#/$defs/track' },
      },
    },
    $defs: {
      source: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { enum: [...SOURCE_KINDS] },
          asset: {
            description: 'An asset id in client_assets. A clip or audio source needs this or url.',
          },
          url: { type: 'string' },
          project: { description: 'A design project id. Required on a design source.' },
          effect: {
            type: 'string',
            description:
              'Required on an fx source, and must name an effect in'
              + ' shared/compositionFx.mjs. The model accepts any string; the'
              + ' renderer refuses one it does not have.',
          },
          params: { type: 'object', description: 'An fx effect\'s own parameters.' },
          transcript: {
            description:
              'Required on a captions source. Either literal cues'
              + ' ([{ word, start, end }]) or the id of the clip source whose'
              + ' transcript to use.',
          },
          template: { type: 'string', description: 'A caption preset id from shared/captions/presets.json.' },
          perLine: { type: 'number', description: 'Words to a caption line. 1 keeps a supplied title whole.' },
          still: {
            type: 'boolean',
            description:
              'This clip is a PHOTOGRAPH. It has no audio stream and its input'
              + ' needs looping, and the render gets both wrong without this.',
          },
          voice: {
            type: 'boolean',
            description: 'This is the narration everything else ducks under.',
          },
          duration: { type: 'number', exclusiveMinimum: 0 },
          width: { type: 'number', minimum: 1 },
          height: { type: 'number', minimum: 1 },
          fps: { type: 'number', exclusiveMinimum: 0 },
        },
        additionalProperties: true,
      },
      track: {
        type: 'object',
        required: ['id', 'kind', 'items'],
        properties: {
          id: { type: 'string' },
          kind: { enum: [...TRACK_KINDS] },
          items: { type: 'array', items: { $ref: '#/$defs/item' } },
        },
        additionalProperties: true,
      },
      item: {
        type: 'object',
        required: ['id', 'at', 'len', 'source'],
        properties: {
          id: { type: 'string' },
          at: { type: 'number', minimum: 0, description: 'Where it starts on the timeline, in seconds.' },
          len: { type: 'number', minimum: MIN_ITEM, description: 'How long it runs.' },
          source: { type: 'string', description: 'A key of `sources`.' },
          in: { type: 'number', minimum: 0, description: 'Where to start inside the source.' },
          fit: { enum: [...FIT_VALUES] },
          gain: { type: 'number', minimum: 0, maximum: 4 },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          trans: {
            type: 'object',
            description:
              'A transition INTO this item. It is an overlap: this item must'
              + ' start before the one before it on the same track ends, or there'
              + ' is no transition whatever this says.',
            properties: { type: { enum: [...TRANSITION_TYPES] } },
            required: ['type'],
            additionalProperties: true,
          },
          scale: animatable(SCALE_MIN, SCALE_MAX, 'A multiplier of the frame.'),
          pos: animatablePoint('An offset from centre, as a fraction of the frame.'),
          rot: animatable(-360, 360,
            'Degrees. The model accepts it and the RENDERER REFUSES IT: rotate\'s'
            + ' output box is init-only, so an animated rotation needs a'
            + ' construction that is not built. Do not put it on an item you'
            + ' intend to render.'),
          reason: { ...rationale, description: 'Why this item is here. Ignored by the renderer.' },
          beat: { ...rationale, description: 'Which camera move this is, for the review sheet.' },
          quote: { ...rationale, description: 'The line of the brief this came from.' },
        },
        additionalProperties: true,
      },
    },
  };
}

/** The committed file's exact text, so a test can compare byte for byte. */
export function schemaText() {
  return `${JSON.stringify(buildSchema(), null, 2)}\n`;
}

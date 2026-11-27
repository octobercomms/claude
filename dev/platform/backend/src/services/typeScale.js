// The type scale, as data: what can be changed, by how much, and from what.
//
// Daniel: "can we add a font sizes and weights editor? list all the font sizes
// and weights with fields to change it. i want to test a few changes. and then
// as Caro uses it, allows them to adjust this also... have a default for
// company and then users can adjust?"
//
// Two levels, resolved on the client: the company default (one row in
// platform_settings, set by an admin) under a per-user override
// (users.ui_prefs). A user who has set nothing follows the company, so an
// admin raising the body size raises it for everyone who has not opted out.
//
// This file is the only list of tokens. The editor renders from it, the route
// validates against it, and a test asserts it matches the `:root` block in
// frontend/src/index.css — because the failure mode of a hand-kept catalogue is
// a token that exists in the CSS, cannot be reached from the editor, and
// therefore looks like the editor is ignoring it.
//
// Bounds are not taste. Below the minimum the interface stops being readable
// and the only way back is a database edit; above the maximum the shell breaks
// (the sidebar labels wrap, table cells blow out of their columns). A user can
// make OMI ugly from here. They must not be able to make it unusable.

// `affects` names the roles each size governs, in words, because the roles are
// not one-to-one with the sizes: .h1 and .h2 share --fs-section, and .h3 shares
// --fs-body with paragraph text. Someone raising Body and finding their card
// headings moved will otherwise conclude the editor is broken. Printing the
// consequence on the row is cheaper than explaining it afterwards.
const SIZE_TOKENS = [
  { token: '--fs-caption', label: 'Caption',     px: 12, min: 10, max: 18,
    affects: 'Labels, chips, table sub-text, kickers' },
  { token: '--fs-body',    label: 'Body',        px: 14, min: 11, max: 20,
    affects: 'Reading text, table cells, card headings (h3), nav' },
  { token: '--fs-title',   label: 'Title',       px: 18, min: 13, max: 28,
    affects: 'Card and panel headings' },
  { token: '--fs-section', label: 'Section',     px: 24, min: 15, max: 40,
    affects: 'Section openers (h1, h2), big stat values' },
  { token: '--fs-display', label: 'Display',     px: 40, min: 20, max: 72,
    affects: 'Page titles, hero numbers (metric)' },
];

// Weights run in hundreds, and only the four Brockmann actually ships.
//
// Measured, not assumed: rendering "Handgloves 2026" at 300 through 900 and
// hashing the pixels gives four distinct images — 300 renders identically to
// 400, and 800 and 900 both render identically to 700. Offering 800 in the
// editor would be a field that visibly does nothing.
//
// It also means `--fw-display` was 800 and rendered at 700, so the stylesheet
// has been claiming a weight the font cannot produce. Corrected to 700, which
// changes no pixels.
//
// A first pass measured advance widths instead and found only two groups,
// because Brockmann's weights are metric-compatible: same widths, different
// shapes. Width is not a test of whether a weight renders.
const WEIGHT_TOKENS = [
  { token: '--fw-display',  label: 'Display',      weight: 700, affects: 'Page titles' },
  { token: '--fw-h1',       label: 'Heading 1',    weight: 700, affects: 'H1' },
  { token: '--fw-h2',       label: 'Heading 2',    weight: 700, affects: 'H2' },
  { token: '--fw-h3',       label: 'Heading 3',    weight: 600, affects: 'H3, card sub-heads' },
  { token: '--fw-body',     label: 'Body',         weight: 400, affects: 'Paragraph text' },
  { token: '--fw-body-sm',  label: 'Body small',   weight: 400, affects: 'Dense body text' },
  { token: '--fw-body-xs',  label: 'Body tiny',    weight: 400, affects: 'Meta lines' },
  { token: '--fw-caption',  label: 'Caption',      weight: 700, affects: 'Uppercase labels' },
  { token: '--fw-metric',   label: 'Metric',       weight: 700, affects: 'KPI numbers' },
  { token: '--fw-kicker',   label: 'Kicker',       weight: 700, affects: 'Tracked-out eyebrows' },
];

// Four named steps, for the person who wants bigger text rather than a scale.
//
// Sizes only. Weight is not a reading-comfort axis — it is how October's work
// looks — and a staffer choosing "Large" is asking to read, not to restyle.
//
// Hand-tuned per step rather than generated from a ratio. The shipped scale
// (12/14/18/24/40) is not on a ratio: the steps are 1.167, 1.286, 1.333 and
// 1.667, because display is deliberately far from section — it is a masthead —
// and caption stays at 12 where its 1.4px uppercase tracking was set. A ratio
// control would flatten all of that on first touch.
//
// Every step holds the ordering caption < body < title < section < display,
// which is what stops a choice here inverting the hierarchy: at body 18 with
// title unchanged, an h3 would be the same size as a card heading.
const PRESETS = [
  { key: 'compact',     label: 'Compact',     values: { '--fs-caption': 11, '--fs-body': 13, '--fs-title': 16, '--fs-section': 22, '--fs-display': 36 } },
  { key: 'default',     label: 'Default',     values: { '--fs-caption': 12, '--fs-body': 14, '--fs-title': 18, '--fs-section': 24, '--fs-display': 40 } },
  { key: 'comfortable', label: 'Comfortable', values: { '--fs-caption': 13, '--fs-body': 15, '--fs-title': 20, '--fs-section': 26, '--fs-display': 44 } },
  { key: 'large',       label: 'Large',       values: { '--fs-caption': 15, '--fs-body': 18, '--fs-title': 22, '--fs-section': 30, '--fs-display': 50 } },
];

const WEIGHT_MIN = 400;
const WEIGHT_MAX = 700;

const SIZE_BY_TOKEN = new Map(SIZE_TOKENS.map(t => [t.token, t]));
const WEIGHT_BY_TOKEN = new Map(WEIGHT_TOKENS.map(t => [t.token, t]));

function defaults() {
  const out = {};
  for (const t of SIZE_TOKENS) out[t.token] = t.px;
  for (const t of WEIGHT_TOKENS) out[t.token] = t.weight;
  return out;
}

function catalogue() {
  return {
    sizes: SIZE_TOKENS.map(t => ({ ...t })),
    weights: WEIGHT_TOKENS.map(t => ({ ...t, min: WEIGHT_MIN, max: WEIGHT_MAX, step: 100 })),
    defaults: defaults(),
    presets: PRESETS.map(p => ({ ...p, values: { ...p.values } })),
  };
}

/**
 * Keep only known tokens, as numbers, inside their bounds.
 *
 * Unknown keys are dropped rather than rejected: the catalogue grows, and a
 * user whose saved prefs mention a token that has since been removed should
 * keep the rest of their settings instead of having the whole save refused.
 *
 * A value outside the bounds is clamped, not dropped. Dropping it silently
 * falls back to the company default, which on the screen looks identical to
 * the save not happening.
 *
 * @param {object} raw
 * @returns {{values: object, clamped: string[], ignored: string[]}}
 */
function sanitise(raw) {
  const values = {};
  const clamped = [];
  const ignored = [];
  for (const [key, input] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const size = SIZE_BY_TOKEN.get(key);
    const weight = WEIGHT_BY_TOKEN.get(key);
    if (!size && !weight) { ignored.push(key); continue; }
    // '' and null mean "stop overriding this one", which is how a single field
    // is reset without clearing the rest.
    if (input === '' || input === null || input === undefined) continue;
    const n = Number(input);
    if (!Number.isFinite(n)) { ignored.push(key); continue; }
    const min = size ? size.min : WEIGHT_MIN;
    const max = size ? size.max : WEIGHT_MAX;
    // Weights snap to the nearest hundred. 650 renders as 600 in Brockmann, so
    // storing it would show a number the screen does not obey.
    const wanted = weight ? Math.round(n / 100) * 100 : Math.round(n);
    const held = Math.min(max, Math.max(min, wanted));
    if (held !== n) clamped.push(key);
    values[key] = held;
  }
  return { values, clamped, ignored };
}

// company < user. Each level supplies only the tokens it overrides.
function resolve(company, user) {
  return { ...defaults(), ...(company || {}), ...(user || {}) };
}

// px for sizes, bare number for weights — what goes on the style attribute.
function cssValue(token, value) {
  return SIZE_BY_TOKEN.has(token) ? `${value}px` : String(value);
}

// Which preset a set of values is, if any. The screen needs this to show the
// chosen step as chosen after a reload, and to say "Default" rather than
// "Custom" for someone who has never touched it.
function presetFor(values) {
  const v = values || {};
  for (const p of PRESETS) {
    if (SIZE_TOKENS.every(t => Number(v[t.token]) === p.values[t.token])) return p.key;
  }
  return null;
}

module.exports = {
  catalogue, defaults, sanitise, resolve, cssValue, presetFor,
  SIZE_TOKENS, WEIGHT_TOKENS, WEIGHT_MIN, WEIGHT_MAX, PRESETS,
};

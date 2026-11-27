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

const SIZE_TOKENS = [
  { token: '--fs-caption', label: 'Caption',     px: 12, min: 10, max: 18,
    affects: 'Labels, meta, chips, table sub-text' },
  { token: '--fs-body',    label: 'Body',        px: 14, min: 11, max: 20,
    affects: 'Default reading size, table cells, buttons, H3' },
  { token: '--fs-title',   label: 'Title',       px: 18, min: 13, max: 28,
    affects: 'Card and section headings' },
  { token: '--fs-section', label: 'Section',     px: 24, min: 15, max: 40,
    affects: 'H1 and H2, sub-hero headings' },
  { token: '--fs-display', label: 'Display',     px: 40, min: 20, max: 72,
    affects: 'Page titles and hero KPI numbers' },
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

module.exports = {
  catalogue, defaults, sanitise, resolve, cssValue,
  SIZE_TOKENS, WEIGHT_TOKENS, WEIGHT_MIN, WEIGHT_MAX,
};

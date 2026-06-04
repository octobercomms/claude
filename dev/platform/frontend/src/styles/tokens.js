// October Marketing Intelligence — design tokens v2.
//
// Dark-mode, app-like visual language inspired by David Ogaga's portfolio
// (https://me.muz.li/davings/david-ogaga-design-portfolio-2): big bold
// type, vibrant single-colour accents per suite, generous radius,
// near-black backgrounds, lots of breathing room.
//
// Legacy primaryBtn / secondaryBtn / COLORS exports stay in theme.js so
// nothing breaks during the rollout. New code imports from here.

// ─── Colour ──────────────────────────────────────────────────────────

export const palette = {
  // Backgrounds — near-black with two elevation steps so cards sit
  // visually above the shell without needing heavy borders.
  bg:           '#0b0b0c',
  surface:      '#141416',
  surfaceRaised:'#1c1c1f',
  surfaceHover: '#222227',

  // Borders — used sparingly; hierarchy is mostly built from surface
  // tone differences.
  border:       '#26262b',
  borderStrong: '#3a3a40',

  // Text. Inverted from the legacy theme.
  text:         '#fafafa',
  textMuted:    '#a0a0a8',
  textSubtle:   '#6e6e76',
  textOnAccent: '#0b0b0c',

  // Suite accents — each suite gets one. Used for headings, CTAs,
  // chart strokes, badge pills. Matches the palette the AM picked.
  suite: {
    social:  '#D35E32',
    organic: '#7C812D',
    paid:    '#FFBB06',
    email:   '#71C6A8',
    press:   '#AD4738',
  },

  // Soft tint of each suite accent for backgrounds (rgba'd at 10-12%
  // alpha so cards can sit on the dark shell without yelling).
  suiteSoft: {
    social:  'rgba(211, 94, 50, 0.12)',
    organic: 'rgba(124, 129, 45, 0.14)',
    paid:    'rgba(255, 187, 6, 0.10)',
    email:   'rgba(113, 198, 168, 0.14)',
    press:   'rgba(173, 71, 56, 0.14)',
  },

  // Semantic
  success: '#71C6A8',
  warning: '#FFBB06',
  danger:  '#E16060',
  info:    '#7AB3E8',
};

export const SUITE_ACCENT = palette.suite;
export const SUITE_SOFT = palette.suiteSoft;

// ─── Spacing ────────────────────────────────────────────────────────
// 4-pt base grid. Use the named scale, not literals.

export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24,
  7: 32, 8: 40, 9: 48, 10: 56, 11: 72, 12: 96,
};

// ─── Radii ──────────────────────────────────────────────────────────

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };

// ─── Type ──────────────────────────────────────────────────────────
// App-like — bigger headings, generous line height, tight tracking on
// large sizes.

export const type = {
  display: { fontSize: 44, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1.2 },
  h1:      { fontSize: 30, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.6 },
  h2:      { fontSize: 20, fontWeight: 700, lineHeight: 1.25, letterSpacing: -0.3 },
  h3:      { fontSize: 15, fontWeight: 600, lineHeight: 1.35 },
  body:    { fontSize: 14, fontWeight: 400, lineHeight: 1.55 },
  bodySm:  { fontSize: 12, fontWeight: 400, lineHeight: 1.5 },
  bodyXs:  { fontSize: 11, fontWeight: 400, lineHeight: 1.4 },
  metric:  { fontSize: 32, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
  caption: { fontSize: 10, fontWeight: 700, lineHeight: 1.2, letterSpacing: 1.2, textTransform: 'uppercase' },
  mono:    { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
};

// ─── Shadows ───────────────────────────────────────────────────────
// Subtle — most depth comes from surface tone, not blurred shadows.

export const shadow = {
  card:    '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
  raised:  '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 16px 40px -16px rgba(0,0,0,0.7)',
  popover: '0 24px 48px -16px rgba(0,0,0,0.8)',
};

// ─── Layout helpers ────────────────────────────────────────────────

export const card = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: radius.lg,
  padding: space[5],
  boxShadow: shadow.card,
};

export const cardRaised = {
  ...card,
  background: palette.surfaceRaised,
  boxShadow: shadow.raised,
};

// ─── Suite presets ─────────────────────────────────────────────────
// Quick-access bundles so suite pages can do `accent={suite.social}`
// without redeclaring colours in every component.

export const suite = {
  social:  { accent: palette.suite.social,  soft: palette.suiteSoft.social,  label: 'Social' },
  organic: { accent: palette.suite.organic, soft: palette.suiteSoft.organic, label: 'Organic' },
  paid:    { accent: palette.suite.paid,    soft: palette.suiteSoft.paid,    label: 'Paid' },
  email:   { accent: palette.suite.email,   soft: palette.suiteSoft.email,   label: 'Email' },
  press:   { accent: palette.suite.press,   soft: palette.suiteSoft.press,   label: 'Press' },
};

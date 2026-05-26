// October Marketing Intelligence — design tokens.
// Single source of truth for brand colours and the canonical pill buttons.
// Components import these so the whole app stays coherent.

export const COLORS = {
  yellow: '#E7CD41',         // Primary action
  yellowDark: '#d4ba36',     // Yellow on hover (slightly darker)
  dark: '#1a1a1a',           // Text on yellow, sidebar, primary headings
  white: '#ffffff',
  border: '#ddd',
  lightGrey: '#e8e8e8',
  mutedText: '#888',
  danger: '#c62828',
  dangerBorder: '#e3b1b1',
};

// Pill primary — used for the headline action on a page or section.
export const primaryBtn = {
  padding: '9px 22px',
  fontSize: 13,
  fontWeight: 700,
  background: COLORS.yellow,
  color: COLORS.dark,
  border: 'none',
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  letterSpacing: -0.1,
};

// Pill secondary — neutral / cancel / less-emphasis actions.
export const secondaryBtn = {
  padding: '9px 22px',
  fontSize: 13,
  fontWeight: 600,
  background: COLORS.white,
  color: COLORS.dark,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

// Same shape as the secondary, but flags destructive actions in red.
export const dangerBtn = {
  ...secondaryBtn,
  color: COLORS.danger,
  borderColor: COLORS.dangerBorder,
};

// Wizard/step indicators — yellow filled circle when the step is the current
// one or already completed; light grey when it's still to come.
export function stepDotStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 12,
    background: active ? COLORS.yellow : COLORS.lightGrey,
    color: active ? COLORS.dark : COLORS.mutedText,
    fontSize: 12,
    fontWeight: 700,
    marginRight: 8,
    flexShrink: 0,
  };
}

// Single button component. Three variants:
//   - primary: filled with the suite accent, dark text. The headline
//     action on a page.
//   - secondary: outlined neutral. Cancel / less-emphasis.
//   - ghost: text-only. Tertiary actions.
//
// Accent is the suite colour — pass `palette.suite.social` etc so the
// CTA visually belongs to the suite it lives on. Defaults to social
// terracotta if not supplied.

import React from 'react';
import { palette, space, radius, type } from '../../styles/tokens';

export default function Button({
  variant = 'primary', accent = palette.suite.social, size = 'md',
  disabled = false, style = {}, children, ...rest
}) {
  const sizeStyles = size === 'sm'
    ? { padding: '6px 14px', fontSize: 12, fontWeight: 600 }
    : size === 'lg'
      ? { padding: '12px 22px', fontSize: 15, fontWeight: 600 }
      : { padding: '9px 18px', fontSize: 13, fontWeight: 600 };

  const variantStyles = (() => {
    if (variant === 'primary') return {
      background: accent,
      color: palette.textOnAccent,
      border: '1px solid transparent',
    };
    if (variant === 'secondary') return {
      background: palette.surfaceRaised,
      color: palette.text,
      border: `1px solid ${palette.borderStrong}`,
    };
    if (variant === 'ghost') return {
      background: 'transparent',
      color: palette.textMuted,
      border: '1px solid transparent',
    };
    if (variant === 'danger') return {
      background: palette.surfaceRaised,
      color: palette.danger,
      border: `1px solid ${palette.border}`,
    };
    return {};
  })();

  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        ...sizeStyles,
        ...variantStyles,
        borderRadius: radius.pill,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'transform 0.05s ease, filter 0.15s ease',
        ...style,
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.98)'; }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      {...rest}
    >
      {children}
    </button>
  );
}

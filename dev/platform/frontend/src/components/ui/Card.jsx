// Surface card. Default is the standard surface tone; pass raised
// for an elevated step (useful for hover-able lists, modal content).
// Accent prop adds a 2px top border in the suite colour — used on
// suite landing cards to colour-code the section.

import React from 'react';
import { palette, radius, shadow, space } from '../../styles/tokens';

export default function Card({
  raised = false, accent = null, padding = space[5], style = {}, children, ...rest
}) {
  const base = {
    background: raised ? palette.surfaceRaised : palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: radius.lg,
    boxShadow: raised ? shadow.raised : shadow.card,
    padding,
    color: palette.text,
    ...(accent ? { borderTop: `2px solid ${accent}` } : {}),
    ...style,
  };
  return <div style={base} {...rest}>{children}</div>;
}

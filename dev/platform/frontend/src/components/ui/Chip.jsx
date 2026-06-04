// Status / category chip. Compact pill used for platform tags,
// statuses, framework labels, etc. Tone controls colour; accent
// optionally tints the background instead of using a tone preset.

import React from 'react';
import { palette, radius } from '../../styles/tokens';

const TONES = {
  neutral: { bg: palette.surfaceRaised, fg: palette.textMuted, border: palette.border },
  accent:  { bg: 'rgba(211,94,50,0.16)', fg: palette.suite.social, border: 'transparent' },
  success: { bg: 'rgba(113,198,168,0.18)', fg: palette.success, border: 'transparent' },
  warning: { bg: 'rgba(255,187,6,0.16)', fg: palette.warning, border: 'transparent' },
  danger:  { bg: 'rgba(225,96,96,0.16)', fg: palette.danger, border: 'transparent' },
};

export default function Chip({ tone = 'neutral', children, style = {}, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: t.bg, color: t.fg,
        border: `1px solid ${t.border}`,
        padding: '2px 9px', borderRadius: radius.pill,
        fontSize: 11, fontWeight: 600, letterSpacing: 0.1,
        ...style,
      }}
      {...rest}
    >{children}</span>
  );
}

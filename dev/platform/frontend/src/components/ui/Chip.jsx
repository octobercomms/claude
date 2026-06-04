// Chip — class-based status pill. Tones map to .chip-* classes.

import React from 'react';

export default function Chip({ tone = 'neutral', className = '', children, ...rest }) {
  const cls = ['chip', `chip-${tone}`, className].filter(Boolean).join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}

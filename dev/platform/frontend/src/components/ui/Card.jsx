// Card — surface block with thick border. Class-based; pass variant
// to switch tones. No inline styles.
//   default: standard surface
//   raised:  elevated tone (modal content, hover lists)
//   accent:  soft-accent bg + thick accent border (hero callouts)
//   outline: transparent bg, thick accent border (lighter callouts)

import React from 'react';

export default function Card({ variant = 'default', className = '', children, ...rest }) {
  const cls = ['card', variant !== 'default' ? variant : '', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}

// Button — class-based variants. Suite accent flows through CSS
// custom properties so the primary CTA is automatically themed by
// the nearest .suite-* scope.
//   variant: primary | secondary | ghost | danger
//   size: sm | md | lg

import React from 'react';

export default function Button({
  variant = 'primary', size = 'md', className = '', children, ...rest
}) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '', className]
    .filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

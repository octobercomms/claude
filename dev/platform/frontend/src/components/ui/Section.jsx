// Section — labelled block with caption overline + h2 title and an
// optional right-aligned action slot.

import React from 'react';

export default function Section({ title, caption, action, children, className = '' }) {
  return (
    <section className={['section', className].filter(Boolean).join(' ')}>
      <div className="section-head">
        <div>
          {caption && <div className="caption">{caption}</div>}
          {title && <h2 className="h2 mt-2">{title}</h2>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  );
}

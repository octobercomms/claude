// Labelled section. Caption-style overline + bold title, optional
// trailing action (right-aligned button or chip). Used wherever a
// suite page splits into named blocks ("Top performers", "Recent
// activity", etc).

import React from 'react';
import { palette, space, type } from '../../styles/tokens';

export default function Section({
  title, caption, action, marginTop = space[7], children,
}) {
  return (
    <div style={{ marginTop }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space[3] }}>
        <div>
          {caption && <div style={{ ...type.caption, color: palette.textSubtle }}>{caption}</div>}
          {title && <div style={{ ...type.h2, color: palette.text, marginTop: caption ? 4 : 0 }}>{title}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

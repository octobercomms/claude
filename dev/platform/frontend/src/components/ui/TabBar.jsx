// Tab bar used at the top of suite landing pages. Active tab has a
// bold underline in the suite accent colour; inactive tabs are muted.
// The whole row is dark; underline is the only colour cue. Matches
// the "very clear" feel the AM asked for.

import React from 'react';
import { palette, space, type, radius } from '../../styles/tokens';

export default function TabBar({ tabs, active, onChange, accent = palette.suite.social }) {
  return (
    <div style={{
      display: 'flex', gap: space[6], borderBottom: `1px solid ${palette.border}`,
      marginTop: space[5], marginBottom: space[6],
    }}>
      {tabs.map(t => {
        const isActive = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            style={{
              background: 'none',
              border: 'none',
              padding: `${space[3]}px 0`,
              borderBottom: `2px solid ${isActive ? accent : 'transparent'}`,
              color: isActive ? palette.text : palette.textMuted,
              fontSize: type.h3.fontSize,
              fontWeight: 600,
              letterSpacing: -0.2,
              cursor: 'pointer',
              marginBottom: -1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: space[2],
            }}
          >
            {t.label}
            {t.badge != null && (
              <span style={{
                background: isActive ? accent : palette.surfaceRaised,
                color: isActive ? palette.textOnAccent : palette.textMuted,
                borderRadius: radius.pill,
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700,
              }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

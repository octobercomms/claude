// Friendly empty-state. Used on every suite when a panel has nothing
// to show. Mandatory CTA so the user never lands on a dead-end.

import React from 'react';
import { palette, space, type, radius } from '../../styles/tokens';
import Button from './Button';

export default function EmptyState({ icon, title, body, action, accent = palette.suite.social }) {
  return (
    <div style={{
      textAlign: 'center', padding: `${space[8]}px ${space[5]}px`,
      background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: radius.lg,
    }}>
      {icon && (
        <div style={{
          width: 56, height: 56, borderRadius: radius.pill,
          background: palette.surfaceRaised, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 26, color: accent, marginBottom: space[4],
        }}>{icon}</div>
      )}
      {title && <div style={{ ...type.h2, color: palette.text }}>{title}</div>}
      {body && <div style={{ ...type.body, color: palette.textMuted, marginTop: space[2], maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>{body}</div>}
      {action && <div style={{ marginTop: space[5] }}>
        <Button variant="primary" accent={accent} onClick={action.onClick}>{action.label}</Button>
      </div>}
    </div>
  );
}

// EmptyState — icon + title + body + CTA. Class-based.

import React from 'react';
import Button from './Button';

export default function EmptyState({ icon, title, body, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      {title && <h2 className="h2">{title}</h2>}
      {body && <p className="body">{body}</p>}
      {action && (
        <Button variant="primary" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

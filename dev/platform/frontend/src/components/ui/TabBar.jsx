// TabBar — class-based. The active tab gets the suite-coloured
// underline via .tab.active.

import React from 'react';

export default function TabBar({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button
          key={t.value}
          type="button"
          className={`tab ${t.value === active ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.badge != null && <span className="chip chip-accent">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

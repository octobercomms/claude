// Suite tab bar — used at the top of pages that share a suite, e.g.
// Organic > [Organic / AI Visibility] and Paid > [Paid / Audiences].
// Each tab is a route, so clicking navigates. Active state is decided
// by URL match. Lives inside whichever suite scope the parent page
// sets so the underline picks up the suite accent.

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function SuiteTabs({ tabs }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="tabs">
      {tabs.map(t => {
        const active = pathname === t.to;
        return (
          <button
            key={t.to}
            type="button"
            className={`tab ${active ? 'active' : ''}`}
            onClick={() => navigate(t.to)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

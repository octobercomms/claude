import React, { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sectionForPath, visibleGroups } from '../nav/sections';
import { useAuth } from '../context/AuthContext';

// The second panel — every destination in the current section, one click away.
//
// This replaces the horizontal tab strips. A strip is good at four or five
// items and shows sequence well; it cannot hold Owned's 29, which is why those
// ended up folded into accordions two levels down. A vertical list holds them
// all, and what it loses — the sense of order a strip gives — is paid back by
// numbering the rows that are genuinely a sequence.
//
// What it does NOT do is route. Rows are ?tab= links on the section's own
// page, so the page keeps owning its state and the panel stays a directory.
//
// Contents live in nav/sections.js, not here, so there is one list to read and
// one list for tests/sectionPanel.test.mjs to check against the pages.
export default function SectionPanel({ navCollapsed, onToggleNav }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const ctx = useMemo(() => ({
    readOnly: user?.role === 'client',
    canVisualise: !!user?.can_use_visualise,
  }), [user?.role, user?.can_use_visualise]);

  const section = sectionForPath(location.pathname);
  const clientId = (location.pathname.match(/^\/clients\/([^/]+)/) || [])[1];
  const activeTab = new URLSearchParams(location.search).get('tab') || section?.defaultTab;

  const groups = useMemo(
    () => (section ? visibleGroups(section, ctx) : []),
    [section, ctx]
  );

  // Which named group is expanded. One at a time: all 29 Owned rows plus their
  // headings run to about 1150px, and a 1080p window gives roughly 950px of
  // usable height, so the whole list open means the bottom group is below the
  // fold. One group open is around 400px — no scrolling, every other group one
  // click away.
  const groupOf = (tab) => groups.find(g => g.heading && g.rows.some(r => r.tab === tab))?.heading || null;
  const [openGroup, setOpenGroup] = useState(() => groupOf(activeTab));

  // Following a link into another group has to open that group, or the active
  // row is hidden behind a collapsed heading and the panel looks like it did
  // nothing. Keyed on the active tab rather than on every render, so a heading
  // the user collapsed by hand stays collapsed.
  useEffect(() => {
    const g = groupOf(activeTab);
    if (g) setOpenGroup(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, section?.key]);

  if (!section || !clientId) return null;

  const go = (tab) => {
    const base = section.base(clientId);
    navigate(tab === section.defaultTab ? base : `${base}?tab=${tab}`);
  };

  const Row = ({ row }) => {
    const active = row.tab === activeTab;
    return (
      <button
        type="button"
        className={`sp-row${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => go(row.tab)}
      >
        {/* A vertical list cannot show order the way a strip can, so a genuine
            sequence says so. Decorative: the label alone is the accessible
            name, and the number is not part of it. */}
        {row.step && <span className="sp-step" aria-hidden="true">{row.step}</span>}
        <span className="sp-label">{row.label}</span>
      </button>
    );
  };

  return (
    <aside className="section-panel" aria-label={`${section.title} sections`}>
      <div className="sp-head">
        <span className="sp-title">{section.title}</span>
        <button
          type="button"
          className="sp-navtoggle"
          onClick={onToggleNav}
          aria-expanded={!navCollapsed}
          title={navCollapsed ? 'Show the main menu' : 'Hide the main menu'}
        >
          {navCollapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sp-list">
        {groups.map((g, i) => (
          <div className="sp-group" key={g.heading || `anon-${i}`}>
            {g.heading ? (
              <button
                type="button"
                className="sp-heading"
                onClick={() => setOpenGroup(cur => (cur === g.heading ? null : g.heading))}
                aria-expanded={openGroup === g.heading}
              >
                <span>{g.heading}</span>
                <span className="sp-heading-mark" aria-hidden="true">{openGroup === g.heading ? '−' : '+'}</span>
              </button>
            ) : null}
            {(!g.heading || openGroup === g.heading) && g.rows.map(row => <Row key={row.tab} row={row} />)}
          </div>
        ))}
      </nav>
    </aside>
  );
}

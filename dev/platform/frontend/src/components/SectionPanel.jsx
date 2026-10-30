import React, { useMemo, useState, useEffect, forwardRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sectionForPath, screenForPath, visibleGroups, slugOf } from '../nav/sections';
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
function SectionPanel({ navCollapsed, onToggleNav }, ref) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const ctx = useMemo(() => ({
    readOnly: user?.role === 'client',
    canVisualise: !!user?.can_use_visualise,
  }), [user?.role, user?.can_use_visualise]);

  const section = sectionForPath(location.pathname);
  const clientId = (location.pathname.match(/^\/clients\/([^/]+)/) || [])[1];
  const activeTab = screenForPath(location.pathname) || section?.defaultTab;

  const groups = useMemo(
    () => (section ? visibleGroups(section, ctx) : []),
    [section, ctx]
  );

  // Everything is open. The first version kept one group open at a time,
  // because Owned's 29 rows plus headings run to about 1150px against roughly
  // 950px of usable height, so the list scrolls. Daniel's read after using it:
  // "i dont want pages hidden. thats more clicks." He is right that the cost
  // is in the wrong place — a collapsed group charges a click on every visit
  // to save a scroll that costs nothing, and the whole point of the panel is
  // that anywhere in the section is one click from anywhere else. Semrush's
  // own panel scrolls for the same reason.
  //
  // A heading still collapses on click, for whoever wants a shorter list; it
  // is just not the default, and nothing stays collapsed across a navigation.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const isOpen = (heading) => !collapsed.has(heading);
  const toggle = (heading) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(heading)) next.delete(heading); else next.add(heading);
    return next;
  });

  // Moving to another section starts fresh: a group someone collapsed inside
  // Owned should not come back collapsed in Shared.
  //
  // This also runs on mount, so seeding the state above with anything is dead
  // code — it is cleared before the first paint. Worth knowing before trying
  // to remember a collapsed group across a reload: that needs storage plus a
  // skip-the-first-run ref, not an initial value.
  useEffect(() => { setCollapsed(new Set()); }, [section?.key]);

  // A client section needs an id to build its rows' links; a global one (
  // Settings) does not, and requiring one here is what kept the Settings
  // panel from ever rendering.
  if (!section) return null;
  if (section.scope === 'client' && !clientId) return null;

  // Every row names its screen, the default included: /seo/dashboard rather
  // than a bare /seo. One URL per screen, so a link is never ambiguous about
  // which one it means.
  const go = (row) => navigate(`${section.base(clientId)}/${slugOf(row)}`);

  const Row = ({ row }) => {
    const active = row.tab === activeTab;
    return (
      <button
        type="button"
        className={`sp-row${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => go(row)}
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
    <aside ref={ref} className="section-panel" aria-label={`${section.title} sections`}>
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
                onClick={() => toggle(g.heading)}
                aria-expanded={isOpen(g.heading)}
              >
                <span>{g.heading}</span>
                <span className="sp-heading-mark" aria-hidden="true">{isOpen(g.heading) ? '−' : '+'}</span>
              </button>
            ) : null}
            {(!g.heading || isOpen(g.heading)) && g.rows.map(row => <Row key={row.tab} row={row} />)}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// Forwarded so Layout can hold this element's scroll position across a
// navigation: it is the one thing on screen that must NOT jump to the top
// when the page does.
export default forwardRef(SectionPanel);

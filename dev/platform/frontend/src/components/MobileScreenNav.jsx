// The section's screens, on a phone.
//
// This replaces the horizontal strip the section panel became at ≤768px. A
// strip was the wrong shape for the same reason the desktop tab strips were:
// Owned has 29 screens, Settings 15, and a 44px sideways scroller holds about
// four of them at a time. Finding "Keyword footprint" meant swiping through a
// list you cannot see the shape of, with no idea how far along you are — the
// worst possible navigation on the device where navigation matters most.
//
// So the phone gets a button that says where you are and a sheet that holds
// everywhere you could go:
//
//   one tap opens it, one tap moves you — a fixed two taps to any screen in
//   the section, where the strip was an unbounded number of swipes;
//
//   groups arrive collapsed except the one you are in, so the sheet opens
//   showing about six rows rather than twenty-nine. Desktop keeps them all
//   open on purpose (Daniel: "i dont want pages hidden. thats more clicks")
//   and that reasoning is about a 950px column with room for the whole list.
//   A phone has no such room: the choice there is between a collapsed group
//   and a scroll through four screenfuls, and one tap beats four swipes;
//
//   the five screens you were last on sit above all of it, because the honest
//   answer to "which of these 29 do you want" is usually one of the handful
//   you have been using. Recorded per section, so Shared's recents are
//   Shared's.
//
// The sheet rises from the bottom and its rows are 48px, because on a phone
// the reachable part of the screen is the bottom third and the panel's 30px
// desktop rows are below the 44px touch minimum.

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sectionForPath, screenForPath, phoneGroups, slugOf, labelForTab } from '../nav/sections';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

const RECENT_KEY = 'omiPhoneRecent';
const RECENT_MAX = 5;

// localStorage is a convenience here and never the source of truth: the sheet
// renders the whole section with or without it, so every read and write is
// allowed to fail silently rather than take the nav down with it.
function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

function pushRecent(sectionKey, tab) {
  try {
    const all = readRecent();
    const list = Array.isArray(all[sectionKey]) ? all[sectionKey] : [];
    const next = [tab, ...list.filter(t => t !== tab)].slice(0, RECENT_MAX + 1);
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...all, [sectionKey]: next }));
  } catch { /* ignore */ }
}

export default function MobileScreenNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile(768);
  const [open, setOpen] = useState(false);

  const ctx = useMemo(() => ({
    readOnly: user?.role === 'client',
    canVisualise: !!user?.can_use_visualise,
  }), [user?.role, user?.can_use_visualise]);

  const section = sectionForPath(location.pathname);
  const clientId = (location.pathname.match(/^\/clients\/([^/]+)/) || [])[1];
  const activeTab = screenForPath(location.pathname) || section?.defaultTab;

  // Recorded on every section visit, phone or not: the history is about where
  // this person works, and they do not stop using the product when they pick
  // up a laptop. Reading it on a phone and writing it everywhere means the
  // list is already useful the first time they open the sheet.
  useEffect(() => {
    if (section && activeTab) pushRecent(section.key, activeTab);
  }, [section, activeTab]);

  // Closing on navigation rather than inside the row handler, so the sheet
  // also closes if something else moves the page under it.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Locking the body while the sheet is up. Without it the page behind
  // scrolls under your finger as soon as a group's rows overflow, and you
  // come back to a screen you did not mean to move.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const groups = useMemo(
    () => (section ? phoneGroups(section, ctx) : []),
    [section, ctx]
  );

  // Which group holds the screen you are on. That one opens; the rest start
  // shut. Recomputed from the section rather than stored, so crossing into
  // another section never inherits the last one's shape.
  const currentHeading = useMemo(() => {
    for (const g of groups) if (g.rows.some(r => r.tab === activeTab)) return g.heading || '';
    return '';
  }, [groups, activeTab]);
  //
  // The state is an override map rather than a set of closed headings,
  // because the default is per-group: the group you are in defaults open and
  // needs a way to shut, every other one defaults shut and needs a way to
  // open. One set cannot express both without a second marker for the
  // negation, which is how the first version of this read.
  const [override, setOverride] = useState({});
  useEffect(() => { setOverride({}); }, [section?.key]);
  const groupOpen = (heading) => {
    if (!heading) return true;                      // nothing to tap, always open
    if (heading in override) return override[heading];
    return heading === currentHeading;
  };
  const toggleGroup = (heading) =>
    setOverride(prev => ({ ...prev, [heading]: !groupOpen(heading) }));

  const go = (row) => navigate(`${section.base(clientId)}/${slugOf(row)}`);

  // Everything above this line is hooks, so it has to run on every render.
  // The bail-outs come after.
  if (!isMobile) return null;
  if (!section) return null;
  if (section.scope === 'client' && !clientId) return null;

  const here = labelForTab(section, activeTab) || section.title;

  // The recents, as rows, minus the screen you are already on — offering to
  // take you where you are is the one row that can never be the answer.
  const recent = (readRecent()[section.key] || [])
    .filter(t => t !== activeTab)
    .map(t => groups.flatMap(g => g.rows).find(r => r.tab === t))
    .filter(Boolean)
    .slice(0, RECENT_MAX);

  return (
    <>
      <div className="msn-bar">
        <button type="button" className="msn-trigger" aria-expanded={open}
          onClick={() => setOpen(o => !o)}>
          <span className="msn-section">{section.title}</span>
          <span className="msn-screen">{here}</span>
          <span className="msn-caret" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
      </div>

      {open && (
        <>
          <div className="msn-scrim" onClick={() => setOpen(false)} />
          <div className="msn-sheet" role="dialog" aria-label={`${section.title} screens`}>
            <div className="msn-sheet-head">
              <span className="msn-sheet-title">{section.title}</span>
              <button type="button" className="msn-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="msn-sheet-body">
              {recent.length > 0 && (
                <div className="msn-group">
                  <div className="msn-heading msn-heading-static">Recent</div>
                  {recent.map(row => (
                    <button key={`r-${row.tab}`} type="button" className="msn-row" onClick={() => go(row)}>
                      <span className="msn-row-label">{row.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {groups.map((g, i) => (
                <div className="msn-group" key={g.heading || `anon-${i}`}>
                  {g.heading && (
                    <button type="button" className="msn-heading" aria-expanded={groupOpen(g.heading)}
                      onClick={() => toggleGroup(g.heading)}>
                      <span>{g.heading}</span>
                      <span className="msn-heading-mark" aria-hidden="true">{groupOpen(g.heading) ? '−' : '+'}</span>
                    </button>
                  )}
                  {groupOpen(g.heading) && g.rows.map(row => (
                    <button key={row.tab} type="button"
                      className={`msn-row${row.tab === activeTab ? ' is-active' : ''}`}
                      aria-current={row.tab === activeTab ? 'page' : undefined}
                      onClick={() => go(row)}>
                      {row.step && <span className="msn-step" aria-hidden="true">{row.step}</span>}
                      <span className="msn-row-label">{row.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

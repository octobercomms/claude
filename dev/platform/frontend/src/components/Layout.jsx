import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import ClientTopBar from './ClientTopBar';
import GlobalSearch, { SearchIcon } from './GlobalSearch';
import AnalystPanel from './AnalystPanel';
import SectionPanel from './SectionPanel';
import MobileScreenNav from './MobileScreenNav';
import { SECTIONS, sectionForPath, screenForPath, labelForTab } from '../nav/sections';


export default function Layout() {
  const { logout, user } = useAuth();
  const readOnly = user?.role === 'client';
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef(null);
  const panelRef = useRef(null);
  // Start a new screen at the top. The screen is a path segment now, so the
  // pathname alone identifies it; this used to need the tab watched as well.
  //
  // The panel is the exception: it has its own scrollbar, and in a tall
  // section (Owned's 27 rows, Settings' 26) you scroll it to reach a row and
  // then watch it snap back the moment you click. Daniel: "clicking an item
  // low down shouldn't make the second panel jump to top — only when i
  // scroll." So its position is captured before the page moves and put back
  // after, in a layout effect, so it is restored before the browser paints
  // and there is no visible jump to correct.
  //
  // .app-main carries `overflow: auto`, but the shell's min-height lets the
  // body grow instead, so the window is the real scroller and the scrollTop
  // line below does nothing on most pages. Both are set rather than guessing
  // which one is live on any given screen.
  useLayoutEffect(() => {
    const panelTop = panelRef.current ? panelRef.current.scrollTop : null;
    if (mainRef.current) mainRef.current.scrollTop = 0;
    window.scrollTo(0, 0);
    if (panelRef.current && panelTop != null) panelRef.current.scrollTop = panelTop;
  }, [location.pathname]);
  // The internal tools October runs beside the platform — a project tracker and
  // a wiki, on their own subdomains. Fetched rather than hard-coded so the
  // hostnames can change without a deploy, and each item only appears once its
  // URL is set, so there is never a menu entry pointing at nothing.
  const [tools, setTools] = useState({ projects: '', docs: '' });
  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get('/settings/workspace-links').then(setTools).catch(() => {});
  }, [user?.role]);

  // Only this one is read for anything but the client id, and the id comes
  // from the path itself. The other eight useMatch calls were a fallback
  // chain behind a regex that already matches every /clients/:id/* path, so
  // they could never contribute — which is how two of them went on naming
  // routes that had been deleted (/outreach moved inside Convert,
  // /sales-traffic became /data) and two more named pages that no longer
  // exist at all (/audiences, /ai-visibility) without anything failing. A
  // ninth matched /clients/:id/chat, which the analyst drawer replaced, and
  // fed an `onChatPage` nothing read.
  const clientSeoMatch = useMatch('/clients/:id/seo');
  // Derive the active client id straight from the path — robust for every
  // /clients/:id/* page without having to enumerate a useMatch for each
  // route. /clients (the list) has no id segment, so the sub-nav correctly
  // stays hidden there.
  const clientId = (location.pathname.match(/^\/clients\/([^/]+)(?:\/|$)/) || [])[1];
  // Which section the current path is in, for lighting the nav. Derived, so
  // adding a screen never means remembering to extend a list here — that list
  // is how ?tab=plan un-lit the Dashboard item.
  const currentSection = sectionForPath(location.pathname);
  const onSeoPage = !!clientSeoMatch;

  // Remember the last client the user was in, so the sidebar "Workspace" item
  // jumps straight back there rather than a redundant client list (the
  // Clients page already lists every client). Switch clients via the header
  // ClientSwitcher. A client-role login only ever has one, so this is a no-op
  // for them.
  useEffect(() => {
    if (clientId) { try { localStorage.setItem('lastClientPath', location.pathname); } catch { /* ignore */ } }
  }, [clientId, location.pathname]);
  let lastClientPath = null;
  try { lastClientPath = localStorage.getItem('lastClientPath'); } catch { /* ignore */ }
  // A client login has exactly one client — Workspace always jumps into it,
  // never the all-clients directory, and never the Dashboard: that is the
  // agency's workspace. Agency users get their last-visited client, or the
  // client list if they have none; from the list, opening a client lands on
  // the Dashboard's Measure tab.
  const workspaceTarget = readOnly
    ? (user?.client_id ? `/clients/${user.client_id}/data` : '/clients')
    : (lastClientPath || '/clients');
  // Workspace lights up inside a client, never on the bare client list — that
  // is the Clients item's own path, and two highlighted items read as a bug.
  const workspaceActive = !!clientId;

  // Search lives here rather than in the client bar so ⌘K works on the client
  // list, in Settings and in the Guide, where that bar does not render.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [navOpen, setNavOpen] = useState(false);
  // Hiding the main menu is a preference about how you work, not about where
  // you are, so it survives navigation and reloads. localStorage can throw in
  // a locked-down browser, and a nav that fails to render is worse than one
  // that forgets, hence the guards.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('navCollapsed') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(v => {
    const next = !v;
    try { localStorage.setItem('navCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  // The analyst panel is page-level state: the icon that opens it lives in the
  // top bar and the panel itself sits outside the page, so neither can own it.
  // ?analyst=1 opens it. That is how the old /clients/:id/chat URL still lands
  // on the analyst now that it is a panel rather than a page, and it gives the
  // panel a deep link of its own.
  const [analystOpen, setAnalystOpen] = useState(() =>
    new URLSearchParams(window.location.search).get('analyst') === '1');
  // Leaving the client closes it — the conversation is per client, and finding
  // another client's thread still open would be worse than losing your place.
  // The ref is not decoration: an effect runs on mount as well as on change, so
  // without it the mount pass closes the panel ?analyst=1 had opened, and the
  // deep link renders the chat for one frame and then hides it.
  const lastClientId = useRef(clientId);
  useEffect(() => {
    if (lastClientId.current === clientId) return;
    lastClientId.current = clientId;
    setAnalystOpen(false);
  }, [clientId]);

  function handleLogout() { logout(); navigate('/login'); }

  const linkStyle = (isActive) => ({
    display: 'block', padding: 'var(--s3) var(--s4)', color: isActive ? '#fff' : 'var(--surface)',
    textDecoration: 'none', fontSize: 'var(--fs-title)', fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2, background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
  });

  // 24px in, 16px out. At the old 40/24 the lane in a 170px nav is 106px and
  // the widest row ("Shared" plus its Social chip, 110px in Brockmann at 14px)
  // clipped; at 24/16 the lane is 130px.
  const subLinkStyle = (isActive) => ({
    display: 'block', padding: 'var(--s2) var(--s4) var(--s2) var(--s6)', color: isActive ? '#fff' : 'rgba(255,255,255,0.78)',
    textDecoration: 'none', fontSize: 'var(--fs-body)', fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2,
  });
  const subSubLinkStyle = (isActive) => ({
    display: 'block', padding: 'var(--s2) var(--s4) var(--s2) var(--s7)', color: isActive ? '#fff' : 'rgba(255,255,255,0.62)',
    textDecoration: 'none', fontSize: 'var(--fs-body)', fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2,
  });

  // What the phone's top bar says. The section, plus the screen inside it
  // when the two are different words — "Shared · Swipe" rather than a bare
  // "Shared", and a bare "Clients" rather than "Clients · Clients".
  const currentScreenLabel = currentSection
    ? labelForTab(currentSection, screenForPath(location.pathname))
    : null;
  const topbarTitle = currentSection
    ? [currentSection.title, currentScreenLabel].filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i).join(' · ')
    : 'Marketing Intelligence';

  return (
    <div className="app-shell">
      <header className="app-topbar">
        {/* On a phone this said "Marketing Intelligence", which is the one
            thing you already know: you opened the app. The bar is 56px of
            the most valuable space on the screen, so it answers the question
            you actually have — which client, and which part of it — with the
            product name kept as a subtitle only where there is no client to
            name. Daniel: "The navigation and titles need to be cleverly
            thought through for mobile purposes." */}
        <span className="app-topbar-brand">{topbarTitle}</span>
        <button className="app-hamburger" onClick={() => setNavOpen(o => !o)} aria-label="Menu" aria-expanded={navOpen}>
          {navOpen ? '✕' : '☰'}
        </button>
      </header>
      <div className={'app-overlay' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)} />
      <nav className={'app-nav' + (navOpen ? ' open' : '') + (navCollapsed ? ' is-collapsed' : '')}
        onClick={() => setNavOpen(false)}>
        <div className="app-nav-brand">
          <img src="/logo-black.gif" alt="October" />
          <div className="brand-sub">Marketing<br/>Intelligence</div>
        </div>

        <ul className="app-nav-list">
          <li>
            <NavLink to="/clients" style={() => linkStyle(location.pathname === '/clients')}>Clients</NavLink>
          </li>
          <li>
            {/* Workspace — the selected client's Dashboard + PESO area.
                Jumps to the last client you were in (Clients is where you
                pick a different one), or the client list if you've none yet. */}
            <NavLink to={workspaceTarget} style={() => linkStyle(workspaceActive)}>Workspace</NavLink>
            {clientId && (
              <div>
                {/* Dashboard first: Measure, Reports and Strategy — what you
                    came to the client for. It is the old Admin renamed and
                    reordered, with Setup and Connectors demoted to the end of
                    its own tab strip because they are not touched once done.
                    Then one item per PESO group, each explained inside its own
                    Overview. */}
                {/* Lit from the path's section, not from a hand-kept list of
                    tab keys. The brand kit used to sit on its own route; it
                    is now inside Setup, which is already a Dashboard screen,
                    so no extra clause is needed for it. It still belongs
                    to the Dashboard as far as the nav is concerned. */}
                {!readOnly && (
                  <NavLink to={`/clients/${clientId}/dashboard`}
                    style={subLinkStyle(currentSection?.key === 'dashboard'
                      )}>Dashboard</NavLink>
                )}
                {/* Data was the analyst behind a nav item. The analyst is now
                    on every page, so for the agency there is nothing left here.
                    A client login keeps it: it is where their own numbers are. */}
                {readOnly && (
                  <NavLink to={`/clients/${clientId}/data`} style={({ isActive }) => subLinkStyle(isActive)}>Data</NavLink>
                )}
                {/* PESO stays the label, with the plain-English name as a chip
                    beside it. Paid/Earned/Shared/Owned is the model we work in
                    and the vocabulary clients hear, so it keeps the position;
                    the chip is there so nobody has to translate before
                    clicking. The chip is decorative — the link's accessible
                    name already carries both words. */}
                {/* Written out rather than mapped over a table: routeDoors
                    looks for a literal `to=` per page, and a path assembled
                    from an array is a door neither the guard nor a human
                    grepping for the route can see. Four lines is the price. */}
                <NavLink to={`/clients/${clientId}/ads`} style={({ isActive }) => subLinkStyle(isActive)}>Paid<span className="nav-chip">Ads</span></NavLink>
                <NavLink to={`/clients/${clientId}/pr`} style={({ isActive }) => subLinkStyle(isActive)}>Earned<span className="nav-chip">PR</span></NavLink>
                <NavLink to={`/clients/${clientId}/social`} style={({ isActive }) => subLinkStyle(isActive)}>Shared<span className="nav-chip">Social</span></NavLink>
                <NavLink to={`/clients/${clientId}/seo`} style={({ isActive }) => subLinkStyle(isActive)}>Owned<span className="nav-chip">SEO</span></NavLink>
                {/* Convert — CRO, Forms and Email, lifted out of Owned. No
                    chip for the same reason Produce has none: the four
                    pillars carry one because PESO needs translating, and
                    "Convert" already says what it is. Above Produce because
                    it is closer to the pillars' job than the media suite is. */}
                <NavLink to={`/clients/${clientId}/convert`} style={({ isActive }) => subLinkStyle(isActive)}>Convert</NavLink>
                {/* Produce — the media suite: Record (video), Edit and Visualise
                    (images) in one place. Visible to clients (Record view-only;
                    Visualise only with the can_use_visualise grant). */}
                <NavLink to={`/clients/${clientId}/produce`} style={({ isActive }) => subLinkStyle(isActive)}>Produce</NavLink>
              </div>
            )}
          </li>
          {/* The internal tools, for the agency only. They live on their own
              origins with their own logins, so this is a signpost rather than
              a gate: hiding the link protects nothing and is not meant to.
              External, hence the arrow and the new tab. */}
          {user?.role === 'admin' && (tools.projects || tools.docs) && (
            <li>
              {tools.projects && (
                <a href={tools.projects} target="_blank" rel="noopener noreferrer"
                  style={linkStyle(false)}>Projects ↗</a>
              )}
              {tools.docs && (
                <a href={tools.docs} target="_blank" rel="noopener noreferrer"
                  style={linkStyle(false)}>Docs ↗</a>
              )}
            </li>
          )}
          {/* Admin-only: Leads (Snapshot Studio) + Settings; Guide sits at the
              bottom of the rail for everyone. */}
          {user?.role === 'admin' && (
            <li>
              {/* Reports and the checker bench are tabs inside this page, not
                  rail items. Both are agency admin touched rarely, and the top
                  rail stays at four. /reports and /lab/checker redirect to
                  their tabs, so old links keep working.
                  Reports had no nav entry at all until 29 Oct 2026 — routed,
                  working, and opened by nothing. Buried is fine; unreachable
                  is not. The alert is not buried with it: "N not sent" is a
                  KPI on Clients, the page you land on, linking straight to the
                  filtered view. */}
              <NavLink to="/settings" style={({ isActive }) => linkStyle(isActive)}>Settings</NavLink>
            </li>
          )}
          {/* Database and Biz dev were groups inside Settings. Neither is
              configuration — the media database is a working surface edited
              all day, and Biz dev is the agency's own pipeline — so both are
              rail items now. Admin-only, like Settings: a client login has no
              business in either. */}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/database" style={({ isActive }) => linkStyle(isActive)}>Database</NavLink>
            </li>
          )}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/biz-dev" style={({ isActive }) => linkStyle(isActive)}>Biz dev</NavLink>
            </li>
          )}
          <li>
            <NavLink to="/guide" style={({ isActive }) => linkStyle(isActive)}>Guide</NavLink>
          </li>
        </ul>

        <div className="app-nav-footer">
          <div className="user-line">
            Signed in as <strong>{user?.username || '…'}</strong>
            {readOnly && <span className="chip chip-neutral" style={{ marginLeft: 'var(--s2)', fontSize: 'var(--fs-caption)' }}>read-only</span>}
          </div>
          <button onClick={() => setShowPassword(true)} className="app-nav-footer-btn">Change password</button>
          <button onClick={handleLogout} className="app-nav-footer-btn">Sign out</button>
          {/* Which build this browser is actually running. Small and dim, but
              it turns "is my change live?" from an afternoon of guessing into
              one glance: compare it with the latest commit on main. */}
          <div className="user-line" style={{ marginTop: 'var(--s2)', opacity: 0.5, fontSize: 'var(--fs-caption)' }}
            title="The commit this browser's bundle was built from. If it is behind main, hard-reload.">
            build {typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}
          </div>
        </div>
      </nav>
      {/* The section's own directory, beside the nav. Renders itself to null
          outside a client section, so /clients, /settings and /guide keep the
          single column they have always had. */}
      <SectionPanel ref={panelRef} navCollapsed={navCollapsed} onToggleNav={toggleNav} />
      {/* The same directory on a phone, as a sheet rather than a column. The
          panel itself is display:none at that width — a 170px fixed column
          beside a 260px drawer leaves nothing for the page. */}
      <MobileScreenNav />
      <main className="app-main" ref={mainRef}>
        {readOnly && (
          <div style={{ background: 'var(--surface-raised)', borderBottom: 'var(--border-w) solid var(--card-border)', padding: 'var(--s2) var(--s4)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
            <span>👁</span>
            <span><strong>Read-only view.</strong> You can explore everything your agency is doing here — nothing on your account can be changed from this login.</span>
          </div>
        )}
        {/* Setup, connector health and the client switcher, on every page in
            the workspace. The plug turns red the moment a connector breaks,
            wherever you happen to be — it used to be a tab you had to decide
            to open. */}
        {/* Search where the client bar does not render: the client list,
            Settings, the Guide, and a client login's own view. The bar itself
            is agency-and-client-scoped, and the thing search is for — "where
            is that" — is asked just as often from the places it is absent.
            Same row position, so the icon does not move when you cross into a
            client. */}
        {!(clientId && !readOnly) && (
          <div className="client-topbar">
            <button
              type="button"
              className="client-topbar-icon"
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              aria-label="Search"
            >
              <SearchIcon />
            </button>
          </div>
        )}
        {clientId && !readOnly && (
          <ClientTopBar
            clientId={clientId}
            analystOpen={analystOpen}
            onToggleAnalyst={() => setAnalystOpen(o => !o)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        )}
        <Outlet />
      </main>
      {clientId && !readOnly && (
        <AnalystPanel
          clientId={clientId}
          open={analystOpen}
          onClose={() => setAnalystOpen(false)}
          pathname={location.pathname}
        />
      )}
      {/* The client a client-scoped screen result opens against: the one in
          the URL, or the last one visited, which is the same value Workspace
          jumps to. Outside a client those screens are not offered at all. */}
      {/* Mounted only while open, so it starts empty every time rather than
          painting one frame of the previous search before clearing it. */}
      {searchOpen && <GlobalSearch
        onClose={() => setSearchOpen(false)}
        clientId={clientId || lastClientPathId(lastClientPath)}
        readOnly={readOnly}
        canVisualise={!!user?.can_use_visualise}
      />}
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function save() {
    setError(null);
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('New password and confirmation don\'t match.');
    setSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">Change password</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        {done ? (
          <div className="text-positive">Password updated.</div>
        ) : (
          <>
            <div className="field">
              <label className="field-label">Current password</label>
              <input className="input" type="password" autoFocus value={current} onChange={e => setCurrent(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">New password</label>
              <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Confirm new password</label>
              <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); }} />
            </div>
            {error && <div className="chip chip-danger" style={{ width: '100%', justifyContent: 'flex-start' }}>{error}</div>}
            <div className="row end mt-5">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !current || !next || !confirm}>
                {saving ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// The client id out of a remembered path. localStorage holds the whole path so
// Workspace can return you to the exact screen; search only needs the id.
function lastClientPathId(path) {
  const m = String(path || '').match(/^\/clients\/([^/]+)/);
  return m && m[1] !== 'new' ? m[1] : null;
}

import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import ClientSwitcher from './ClientSwitcher';

export default function Layout() {
  const { logout, user } = useAuth();
  const readOnly = user?.role === 'client';
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef(null);
  // Reset the scroll position to the top whenever the route (path) changes, so
  // landing on a new page starts at the top — not wherever you were before.
  // Keyed on pathname only, so switching tabs (?tab=…) leaves scroll alone.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const clientMatch = useMatch('/clients/:id');
  const clientSeoMatch = useMatch('/clients/:id/seo');
  const clientChatMatch = useMatch('/clients/:id/chat');
  const clientAdsMatch = useMatch('/clients/:id/ads');
  const clientOutreachMatch = useMatch('/clients/:id/outreach');
  const clientSalesMatch = useMatch('/clients/:id/sales-traffic');
  const clientSocialMatch = useMatch('/clients/:id/social');
  const clientBrandMatch = useMatch('/clients/:id/brand');
  const clientAudiencesMatch = useMatch('/clients/:id/audiences');
  const clientAiVisMatch = useMatch('/clients/:id/ai-visibility');
  // Derive the active client id straight from the path — robust for every
  // /clients/:id/* page (chat, audiences, etc.) without having to enumerate
  // a useMatch for each route. /clients (the list) has no id segment, so the
  // sub-nav correctly stays hidden there.
  const clientId = (location.pathname.match(/^\/clients\/([^/]+)(?:\/|$)/) || [])[1]
    || clientMatch?.params?.id || clientSeoMatch?.params?.id || clientChatMatch?.params?.id || clientAdsMatch?.params?.id || clientOutreachMatch?.params?.id || clientSalesMatch?.params?.id || clientSocialMatch?.params?.id || clientBrandMatch?.params?.id || clientAudiencesMatch?.params?.id || clientAiVisMatch?.params?.id;
  const currentTab = new URLSearchParams(location.search).get('tab') || 'setup_overview';
  const onSeoPage = !!clientSeoMatch;
  const onChatPage = !!clientChatMatch;

  // Remember the last client the user was in, so the sidebar "Workspace" item
  // jumps straight back there rather than a redundant client list (the
  // Dashboard already lists every client). Switch clients via the header
  // ClientSwitcher. A client-role login only ever has one, so this is a no-op
  // for them.
  useEffect(() => {
    if (clientId) { try { localStorage.setItem('lastClientPath', location.pathname); } catch { /* ignore */ } }
  }, [clientId, location.pathname]);
  let lastClientPath = null;
  try { lastClientPath = localStorage.getItem('lastClientPath'); } catch { /* ignore */ }
  // A client login has exactly one client — Workspace always jumps into it
  // (Data first), never the all-clients directory. Agency users get their
  // last-visited client, or the picker if they've none.
  const workspaceTarget = readOnly
    ? (user?.client_id ? `/clients/${user.client_id}/sales-traffic` : '/dashboard')
    : (lastClientPath || '/clients');
  const workspaceActive = location.pathname.startsWith('/clients');

  const [navOpen, setNavOpen] = useState(false);

  function handleLogout() { logout(); navigate('/login'); }

  const linkStyle = (isActive) => ({
    display: 'block', padding: '11px 24px', color: isActive ? 'var(--accent)' : 'var(--surface)',
    textDecoration: 'none', fontSize: 16, fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2, background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
  });

  const subLinkStyle = (isActive) => ({
    display: 'block', padding: '8px 24px 8px 36px', color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.78)',
    textDecoration: 'none', fontSize: 14, fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2,
  });
  const subSubLinkStyle = (isActive) => ({
    display: 'block', padding: '6px 24px 6px 56px', color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.62)',
    textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
    letterSpacing: 0.2,
  });

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <span className="app-topbar-brand">Marketing Intelligence</span>
        <button className="app-hamburger" onClick={() => setNavOpen(o => !o)} aria-label="Menu" aria-expanded={navOpen}>
          {navOpen ? '✕' : '☰'}
        </button>
      </header>
      <div className={'app-overlay' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)} />
      <nav className={'app-nav' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
        <div className="app-nav-brand">
          <img src="/logo-black.gif" alt="October" />
          <div className="brand-sub">Marketing<br/>Intelligence</div>
        </div>

        <ul className="app-nav-list">
          <li>
            <NavLink to="/dashboard" style={({ isActive }) => linkStyle(isActive)}>Dashboard</NavLink>
          </li>
          <li>
            {/* Workspace — the selected client's PESO + Data + Admin area.
                Jumps to the last client you were in (Dashboard is where you
                pick a different one), or the client picker if you've none yet. */}
            <NavLink to={workspaceTarget} style={() => linkStyle(workspaceActive)}>Workspace</NavLink>
            {clientId && (
              <div>
                {/* One clickable item per PESO group (Data · Paid · Earned ·
                    Shared · Owned · Admin). Each opens that group's page; the
                    function (social, organic, email, …) is explained inside
                    each section's Overview. */}
                <NavLink to={`/clients/${clientId}/sales-traffic`} style={({ isActive }) => subLinkStyle(isActive)}>Data</NavLink>
                <NavLink to={`/clients/${clientId}/ads`} style={({ isActive }) => subLinkStyle(isActive)}>Paid</NavLink>
                <NavLink to={`/clients/${clientId}/pr`} style={({ isActive }) => subLinkStyle(isActive)}>Earned</NavLink>
                <NavLink to={`/clients/${clientId}/social`} style={({ isActive }) => subLinkStyle(isActive)}>Shared</NavLink>
                <NavLink to={`/clients/${clientId}/seo`} style={({ isActive }) => subLinkStyle(isActive)}>Owned</NavLink>
                {/* Visualise — image studio. Agency users always; a read-only
                    client only when granted can_use_visualise (§6). */}
                {(!readOnly || user?.can_use_visualise) && (
                  <NavLink to={`/clients/${clientId}/visualise`} style={({ isActive }) => subLinkStyle(isActive)}>Visualise</NavLink>
                )}
                {/* Edit — guided video editor (trim / clean audio / captions). Agency-only. */}
                {!readOnly && (
                  <NavLink to={`/clients/${clientId}/edit`} style={({ isActive }) => subLinkStyle(isActive)}>Edit</NavLink>
                )}
                {/* Admin (connectors, strategy config, reports setup) is agency-only. */}
                {!readOnly && (
                  <NavLink to={`/clients/${clientId}?tab=setup_overview`} style={subLinkStyle(!!clientMatch && ['setup_overview', 'strategy', 'details', 'brand', 'connectors', 'reports'].includes(currentTab))}>Admin</NavLink>
                )}
              </div>
            )}
          </li>
          {/* Admin-only: Leads (Snapshot Studio) + Settings; Guide sits at the
              bottom of the rail for everyone. */}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/leads" style={({ isActive }) => linkStyle(isActive)}>Leads</NavLink>
            </li>
          )}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/settings" style={({ isActive }) => linkStyle(isActive)}>Settings</NavLink>
            </li>
          )}
          {/* Video — in-house screen recorder + library (Loom replacement). Agency-only. */}
          {!readOnly && (
            <li>
              <NavLink to="/video" style={({ isActive }) => linkStyle(isActive)}>Video</NavLink>
            </li>
          )}
          <li>
            <NavLink to="/guide" style={({ isActive }) => linkStyle(isActive)}>Guide</NavLink>
          </li>
        </ul>

        <div className="app-nav-footer">
          <div className="user-line">
            Signed in as <strong>{user?.username || '…'}</strong>
            {readOnly && <span className="chip chip-neutral" style={{ marginLeft: 6, fontSize: 9 }}>read-only</span>}
          </div>
          <button onClick={() => setShowPassword(true)} className="app-nav-footer-btn">Change password</button>
          <button onClick={handleLogout} className="app-nav-footer-btn">Sign out</button>
        </div>
      </nav>
      <main className="app-main" ref={mainRef}>
        {readOnly && (
          <div style={{ background: 'var(--surface-raised)', borderBottom: 'var(--border-w) solid var(--card-border)', padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>👁</span>
            <span><strong>Read-only view.</strong> You can explore everything your agency is doing here — nothing on your account can be changed from this login.</span>
          </div>
        )}
        {clientId && !readOnly && <ClientSwitcher clientId={clientId} />}
        <Outlet />
      </main>
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


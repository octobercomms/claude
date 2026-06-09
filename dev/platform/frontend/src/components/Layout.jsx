import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';

export default function Layout() {
  const { logout, user } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
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
  // Non-clickable PESO group label in the client sub-nav.
  const navGroupStyle = {
    padding: '12px 24px 3px 24px', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(255,255,255,0.4)',
  };

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
          {[
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/clients', label: 'Clients' },
          ].map(item => (
            <li key={item.to}>
              <NavLink to={item.to} style={({ isActive }) => linkStyle(isActive)}>{item.label}</NavLink>
              {item.to === '/clients' && clientId && (
                <div>
                  {/* Grouped by the PESO model (Paid · Earned · Shared · Owned),
                      bookended by Data (overview/analysis) and Admin. */}
                  <div style={navGroupStyle}>Data</div>
                  <NavLink to={`/clients/${clientId}/sales-traffic`} style={({ isActive }) => subLinkStyle(isActive)}>Sales &amp; Traffic</NavLink>
                  <NavLink to={`/clients/${clientId}/chat`} style={({ isActive }) => subLinkStyle(isActive)}>AI Data Analyst</NavLink>
                  <div style={navGroupStyle}>Paid</div>
                  <NavLink to={`/clients/${clientId}/ads`} style={({ isActive }) => subLinkStyle(isActive)}>Ads</NavLink>
                  <div style={navGroupStyle}>Earned</div>
                  <NavLink to={`/clients/${clientId}/pr`} style={({ isActive }) => subLinkStyle(isActive)}>PR</NavLink>
                  <div style={navGroupStyle}>Shared</div>
                  <NavLink to={`/clients/${clientId}/social`} style={({ isActive }) => subLinkStyle(isActive)}>Social</NavLink>
                  <div style={navGroupStyle}>Owned</div>
                  <NavLink to={`/clients/${clientId}/seo`} style={({ isActive }) => subLinkStyle(isActive)}>Organic</NavLink>
                  <NavLink to={`/clients/${clientId}/outreach`} style={({ isActive }) => subLinkStyle(isActive)}>Email</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=forms`} style={subLinkStyle(!!clientMatch && currentTab === 'forms')}>Forms</NavLink>
                  <div style={navGroupStyle}>Admin</div>
                  <NavLink to={`/clients/${clientId}?tab=reports`} style={subLinkStyle(!!clientMatch && currentTab === 'reports')}>Reports</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=setup_overview`} style={subLinkStyle(!!clientMatch && ['setup_overview', 'details', 'brand', 'connectors'].includes(currentTab))}>Setup</NavLink>
                </div>
              )}
            </li>
          ))}
          {/* Admin-only: Settings (with Users tab); Guide goes below so it
              sits at the bottom of the rail for everyone. */}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/media" style={({ isActive }) => linkStyle(isActive)}>Press</NavLink>
            </li>
          )}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/settings" style={({ isActive }) => linkStyle(isActive)}>Settings</NavLink>
            </li>
          )}
          <li>
            <NavLink to="/guide" style={({ isActive }) => linkStyle(isActive)}>Guide</NavLink>
          </li>
        </ul>

        <div className="app-nav-footer">
          <div className="user-line">
            Signed in as <strong>{user?.username || '…'}</strong>
          </div>
          <button onClick={() => setShowPassword(true)} className="app-nav-footer-btn">Change password</button>
          <button onClick={handleLogout} className="app-nav-footer-btn">Sign out</button>
        </div>
      </nav>
      <main className="app-main">
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


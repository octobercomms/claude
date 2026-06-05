import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { primaryBtn, secondaryBtn } from '../styles/theme';

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
  const clientId = clientMatch?.params?.id || clientSeoMatch?.params?.id || clientChatMatch?.params?.id || clientAdsMatch?.params?.id || clientOutreachMatch?.params?.id || clientSalesMatch?.params?.id || clientSocialMatch?.params?.id || clientBrandMatch?.params?.id;
  const currentTab = new URLSearchParams(location.search).get('tab') || 'details';
  const onSeoPage = !!clientSeoMatch;
  const onChatPage = !!clientChatMatch;

  const [navOpen, setNavOpen] = useState(false);

  function handleLogout() { logout(); navigate('/login'); }

  const linkStyle = (isActive) => ({
    display: 'block', padding: '11px 24px', color: isActive ? 'var(--accent)' : '#ffffff',
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
      <button className="app-hamburger" onClick={() => setNavOpen(o => !o)} aria-label="Menu">
        {navOpen ? '✕' : '☰'}
      </button>
      <div className={'app-overlay' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)} />
      <nav className={'app-nav' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
        <div style={styles.navBrand}>
          <img src="/logo-black.gif" alt="October" style={styles.logo} />
          <div style={styles.brandSub}>Marketing<br/>Intelligence</div>
        </div>

        <ul style={styles.navList}>
          {[
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/clients', label: 'Clients' },
          ].map(item => (
            <li key={item.to}>
              <NavLink to={item.to} style={({ isActive }) => linkStyle(isActive)}>{item.label}</NavLink>
              {item.to === '/clients' && clientId && (
                <div>
                  <NavLink to={`/clients/${clientId}/sales-traffic`} style={({ isActive }) => subLinkStyle(isActive)}>Sales &amp; Traffic</NavLink>
                  <NavLink to={`/clients/${clientId}/chat`} style={({ isActive }) => subLinkStyle(isActive)}>AI Data Analyst</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=reports`} style={subLinkStyle(!!clientMatch && currentTab === 'reports')}>Reports</NavLink>
                  <NavLink to={`/clients/${clientId}/seo`} style={({ isActive }) => subLinkStyle(isActive)}>Organic</NavLink>
                  <NavLink to={`/clients/${clientId}/ads`} style={({ isActive }) => subLinkStyle(isActive)}>Paid</NavLink>
                  <NavLink to={`/clients/${clientId}/social`} style={({ isActive }) => subLinkStyle(isActive)}>Social</NavLink>
                  <NavLink to={`/clients/${clientId}/outreach`} style={({ isActive }) => subLinkStyle(isActive)}>Email</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=forms`} style={subLinkStyle(!!clientMatch && currentTab === 'forms')}>Forms</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=details`} style={subLinkStyle(!!clientMatch && ['details', 'brand', 'connectors'].includes(currentTab))}>Setup</NavLink>
                </div>
              )}
            </li>
          ))}
          {/* Admin-only: Settings (with Users tab); Guide goes below so it
              sits at the bottom of the rail for everyone. */}
          {user?.role === 'admin' && (
            <li>
              <NavLink to="/settings" style={({ isActive }) => linkStyle(isActive)}>Settings</NavLink>
            </li>
          )}
          <li>
            <NavLink to="/guide" style={({ isActive }) => linkStyle(isActive)}>Guide</NavLink>
          </li>
        </ul>

        <div style={styles.footerBlock}>
          <div style={styles.userLine}>
            Signed in as <strong>{user?.username || '…'}</strong>
          </div>
          <button onClick={() => setShowPassword(true)} style={styles.footerBtn}>Change password</button>
          <button onClick={handleLogout} style={styles.footerBtn}>Sign out</button>
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
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>Change password</h2>
        {done ? (
          <div style={{ padding: '10px 0', color: '#2e7d32' }}>Password updated.</div>
        ) : (
          <>
            <label style={modalStyles.label}>Current password</label>
            <input type="password" autoFocus value={current} onChange={e => setCurrent(e.target.value)} style={modalStyles.input} />
            <label style={modalStyles.label}>New password</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} style={modalStyles.input} />
            <label style={modalStyles.label}>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              style={modalStyles.input} />
            {error && <div style={modalStyles.error}>{error}</div>}
            <div style={modalStyles.footer}>
              <button type="button" style={secondaryBtn} onClick={onClose}>Cancel</button>
              <button type="button" style={primaryBtn} onClick={save} disabled={saving || !current || !next || !confirm}>
                {saving ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const modalStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '80px 20px', zIndex: 1100 },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 420, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  error: { color: '#c62828', fontSize: 12, marginTop: 10, padding: 8, background: '#fdecea', borderRadius: 4 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
};

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f5f5f5' },
  nav: {
    width: 220, background: '#000000', color: 'white',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
  },
  navBrand: { padding: '20px 20px 16px', borderBottom: '1px solid #1a1a1a' },
  logo: { width: '50%', height: 'auto', display: 'block' },
  brandSub: { fontSize: 18, color: '#ffffff', marginTop: 20, letterSpacing: 0.3, fontWeight: 400 },
  navList: { listStyle: 'none', padding: '12px 0', margin: 0, flex: 1 },
  footerBlock: { padding: '0 16px 20px', borderTop: '1px solid #1a1a1a', paddingTop: 14 },
  userLine: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 10, letterSpacing: 0.2 },
  footerBtn: {
    width: '100%', marginBottom: 6, padding: '8px 12px', background: 'transparent',
    border: '1px solid #333', color: 'white', borderRadius: 4,
    cursor: 'pointer', fontSize: 12,
  },
  logoutBtn: {
    margin: '0 16px 20px', padding: '8px 12px', background: 'transparent',
    border: '1px solid #333', color: 'white', borderRadius: 4,
    cursor: 'pointer', fontSize: 12,
  },
  main: { flex: 1, padding: '32px', overflow: 'auto' },
};

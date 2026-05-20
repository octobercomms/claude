import React from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
];

const CLIENT_SUBNAV = [
  { tab: 'details', label: 'Details' },
  { tab: 'connectors', label: 'Connectors' },
  { tab: 'recipients', label: 'Recipients' },
  { tab: 'schedule', label: 'Schedule' },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const clientMatch = useMatch('/clients/:id');
  const clientSeoMatch = useMatch('/clients/:id/seo');
  const clientId = clientMatch?.params?.id || clientSeoMatch?.params?.id;

  const currentTab = new URLSearchParams(location.search).get('tab') || 'details';
  const onSeoPage = !!clientSeoMatch;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <img src="/logo-black.gif" alt="October" style={styles.logo} />
          <div style={styles.brandSub}>Performance<br/>Marketing<br/>Platform</div>
        </div>
        <ul style={styles.navList}>
          {NAV.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                style={({ isActive }) => ({
                  ...styles.navLink,
                  ...(isActive ? styles.navLinkActive : {}),
                })}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        {clientId && (
          <div style={styles.subnav}>
            <div style={styles.subnavLabel}>Client</div>
            {CLIENT_SUBNAV.map(item => (
              <NavLink
                key={item.tab}
                to={`/clients/${clientId}?tab=${item.tab}`}
                style={{
                  ...styles.subnavLink,
                  ...(!onSeoPage && currentTab === item.tab ? styles.subnavLinkActive : {}),
                }}
              >
                {item.label}
              </NavLink>
            ))}
            <NavLink
              to={`/clients/${clientId}/seo`}
              style={({ isActive }) => ({
                ...styles.subnavLink,
                ...(isActive ? styles.subnavLinkActive : {}),
              })}
            >
              SEO &amp; Rankings
            </NavLink>
          </div>
        )}

        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </nav>
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f5f5f5' },
  nav: {
    width: 220, background: '#000000', color: 'white',
    display: 'flex', flexDirection: 'column', padding: '0 0 20px', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
  },
  navBrand: { padding: '20px 20px 16px', borderBottom: '1px solid #1a1a1a' },
  logo: { width: '50%', height: 'auto', display: 'block' },
  brandSub: { fontSize: 18, color: '#ffffff', marginTop: 10, letterSpacing: 0.3, fontWeight: 400 },
  navList: { listStyle: 'none', padding: '16px 0 0', margin: 0 },
  navLink: {
    display: 'block', padding: '10px 24px', color: '#666',
    textDecoration: 'none', fontSize: 13, fontWeight: 400,
    transition: 'color 0.15s, background 0.15s',
    borderLeft: '2px solid transparent',
    letterSpacing: 0.2,
  },
  navLinkActive: { color: 'white', background: '#111', borderLeftColor: 'white' },
  subnav: { margin: '16px 0 0', borderTop: '1px solid #1a1a1a', paddingTop: 12, flex: 1 },
  subnavLabel: { padding: '0 24px 8px', fontSize: 10, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: 1 },
  subnavLink: {
    display: 'block', padding: '8px 24px 8px 36px', color: '#555',
    textDecoration: 'none', fontSize: 12, fontWeight: 400,
    borderLeft: '2px solid transparent',
    letterSpacing: 0.2,
  },
  subnavLinkActive: { color: '#ccc', borderLeftColor: '#555' },
  logoutBtn: {
    margin: '16px 16px 0', padding: '8px 12px', background: 'transparent',
    border: '1px solid #222', color: '#555', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontFamily: 'Brockmann, sans-serif',
  },
  main: { flex: 1, padding: '32px', overflow: 'auto', maxWidth: 1200 },
};

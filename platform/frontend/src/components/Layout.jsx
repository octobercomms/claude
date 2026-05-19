import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/reports', label: 'Reports' },
  { to: '/rankings', label: 'Rankings' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <OctoberLogo />
          <div style={styles.brandSub}>Performance Platform</div>
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
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </nav>
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function OctoberLogo() {
  return (
    <div style={styles.logoWrap}>
      <span style={styles.logoText}>OCTOBER</span>
      <span style={styles.logoDot}>.</span>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f5f5f5' },
  nav: {
    width: 220, background: '#000000', color: 'white',
    display: 'flex', flexDirection: 'column', padding: '0 0 20px', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh',
  },
  navBrand: { padding: '28px 24px 22px', borderBottom: '1px solid #1a1a1a' },
  logoWrap: { display: 'flex', alignItems: 'baseline', lineHeight: 1 },
  logoText: { fontSize: 18, fontWeight: 600, letterSpacing: 2, color: 'white', fontFamily: 'Brockmann, sans-serif' },
  logoDot: { fontSize: 18, fontWeight: 600, color: 'white', fontFamily: 'Brockmann, sans-serif' },
  brandSub: { fontSize: 9, color: '#555', marginTop: 6, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 400 },
  navList: { listStyle: 'none', padding: '16px 0', margin: 0, flex: 1 },
  navLink: {
    display: 'block', padding: '10px 24px', color: '#666',
    textDecoration: 'none', fontSize: 13, fontWeight: 400,
    transition: 'color 0.15s, background 0.15s',
    borderLeft: '2px solid transparent',
    letterSpacing: 0.2,
  },
  navLinkActive: { color: 'white', background: '#111', borderLeftColor: 'white' },
  logoutBtn: {
    margin: '0 16px', padding: '8px 12px', background: 'transparent',
    border: '1px solid #222', color: '#555', borderRadius: 4,
    cursor: 'pointer', fontSize: 12, fontFamily: 'Brockmann, sans-serif',
  },
  main: { flex: 1, padding: '32px', overflow: 'auto', maxWidth: 1200 },
};

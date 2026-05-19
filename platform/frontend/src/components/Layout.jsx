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
    position: 'sticky', top: 0, height: '100vh',
  },
  navBrand: { padding: '20px 20px 16px', borderBottom: '1px solid #1a1a1a' },
  logo: { width: '50%', height: 'auto', display: 'block' },
  brandSub: { fontSize: 18, color: '#ffffff', marginTop: 10, letterSpacing: 0.3, fontWeight: 400 },
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

import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◻' },
  { to: '/clients', label: 'Clients', icon: '◻' },
  { to: '/reports', label: 'Reports', icon: '◻' },
  { to: '/rankings', label: 'Rankings', icon: '◻' },
  { to: '/settings', label: 'Settings', icon: '◻' },
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
          <div style={styles.brandName}>OCTOBER</div>
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

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f5f5f5' },
  nav: {
    width: 220, background: '#1a1a1a', color: 'white',
    display: 'flex', flexDirection: 'column', padding: '0 0 20px', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh',
  },
  navBrand: { padding: '28px 24px 24px', borderBottom: '1px solid #333' },
  brandName: { fontSize: 14, fontWeight: 700, letterSpacing: 3, color: 'white' },
  brandSub: { fontSize: 10, color: '#888', marginTop: 4, letterSpacing: 1 },
  navList: { listStyle: 'none', padding: '16px 0', margin: 0, flex: 1 },
  navLink: {
    display: 'block', padding: '10px 24px', color: '#aaa',
    textDecoration: 'none', fontSize: 13, fontWeight: 500,
    transition: 'color 0.15s, background 0.15s',
    borderLeft: '3px solid transparent',
  },
  navLinkActive: { color: 'white', background: '#262626', borderLeftColor: 'white' },
  logoutBtn: {
    margin: '0 16px', padding: '8px 12px', background: 'transparent',
    border: '1px solid #444', color: '#888', borderRadius: 4,
    cursor: 'pointer', fontSize: 12,
  },
  main: { flex: 1, padding: '32px', overflow: 'auto', maxWidth: 1200 },
};

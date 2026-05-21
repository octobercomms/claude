import React from 'react';
import { Outlet, NavLink, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const clientMatch = useMatch('/clients/:id');
  const clientSeoMatch = useMatch('/clients/:id/seo');
  const clientChatMatch = useMatch('/clients/:id/chat');
  const clientAdsMatch = useMatch('/clients/:id/ads');
  const clientId = clientMatch?.params?.id || clientSeoMatch?.params?.id || clientChatMatch?.params?.id || clientAdsMatch?.params?.id;
  const currentTab = new URLSearchParams(location.search).get('tab') || 'details';
  const onSeoPage = !!clientSeoMatch;
  const onChatPage = !!clientChatMatch;

  function handleLogout() { logout(); navigate('/login'); }

  const linkStyle = (isActive) => ({
    display: 'block', padding: '10px 24px', color: isActive ? '#E7CD41' : '#ffffff',
    textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? '#E7CD41' : 'transparent'}`,
    letterSpacing: 0.2, background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
  });

  const subLinkStyle = (isActive) => ({
    display: 'block', padding: '7px 24px 7px 36px', color: isActive ? '#E7CD41' : 'rgba(255,255,255,0.75)',
    textDecoration: 'none', fontSize: 12, fontWeight: isActive ? 600 : 400,
    borderLeft: `2px solid ${isActive ? '#E7CD41' : 'transparent'}`,
    letterSpacing: 0.2,
  });

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <img src="/logo-black.gif" alt="October" style={styles.logo} />
          <div style={styles.brandSub}>Performance<br/>Marketing<br/>Platform</div>
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
                  <NavLink to={`/clients/${clientId}?tab=details`} style={subLinkStyle(!!clientMatch && currentTab === 'details')}>Details</NavLink>
                  <NavLink to={`/clients/${clientId}/chat`} style={({ isActive }) => subLinkStyle(isActive)}>Data Analyst</NavLink>
                  <NavLink to={`/clients/${clientId}/seo`} style={({ isActive }) => subLinkStyle(isActive)}>SEO</NavLink>
                  <NavLink to={`/clients/${clientId}/ads`} style={({ isActive }) => subLinkStyle(isActive)}>Ads</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=reports`} style={subLinkStyle(!!clientMatch && currentTab === 'reports')}>Reports</NavLink>
                  <NavLink to={`/clients/${clientId}?tab=connectors`} style={subLinkStyle(!!clientMatch && currentTab === 'connectors')}>Connectors</NavLink>
                </div>
              )}
            </li>
          ))}
          {[
            { to: '/settings', label: 'Settings' },
          ].map(item => (
            <li key={item.to}>
              <NavLink to={item.to} style={({ isActive }) => linkStyle(isActive)}>{item.label}</NavLink>
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
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
  },
  navBrand: { padding: '20px 20px 16px', borderBottom: '1px solid #1a1a1a' },
  logo: { width: '50%', height: 'auto', display: 'block' },
  brandSub: { fontSize: 18, color: '#ffffff', marginTop: 20, letterSpacing: 0.3, fontWeight: 400 },
  navList: { listStyle: 'none', padding: '12px 0', margin: 0, flex: 1 },
  logoutBtn: {
    margin: '0 16px 20px', padding: '8px 12px', background: 'transparent',
    border: '1px solid #333', color: 'white', borderRadius: 4,
    cursor: 'pointer', fontSize: 12,
  },
  main: { flex: 1, padding: '32px', overflow: 'auto' },
};

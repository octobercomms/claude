import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  const { pathname } = useLocation();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: 'var(--s8)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 'var(--fs-display)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--s2)' }}>404</div>
      <div style={{ fontSize: 'var(--fs-title)', color: 'var(--text-muted)', marginBottom: 'var(--s4)' }}>
        Nothing lives at <code style={{ background: 'var(--surface-raised)', padding: '2px 6px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)' }}>{pathname}</code>
      </div>
      <Link to="/clients" className="btn btn-primary" style={{ textDecoration: 'none' }}>Back to clients</Link>
    </div>
  );
}

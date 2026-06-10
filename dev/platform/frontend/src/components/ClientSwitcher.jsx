import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

// Floating top-right dropdown that lets the AM switch which client they're
// looking at without bouncing back to the Clients list. Renders only when
// the URL is /clients/:id/* — Layout wires that in. Preserves the sub-path
// (sales-traffic / social / pr / setup / etc.) and the ?tab= query param so
// switching from "Acme · Social" lands on "Beta · Social", not a different
// section.
export default function ClientSwitcher({ clientId }) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    api.get('/clients').then(setClients).catch(() => {});
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-focus the search when the menu opens — AMs typically know which
  // client they want, typing 2–3 letters is faster than scrolling.
  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  const current = clients.find(c => c.id === clientId);
  const filtered = query
    ? clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : clients;

  function switchTo(newId) {
    if (newId === clientId) { setOpen(false); return; }
    // Replace the id segment in /clients/<id>/... and preserve the trailing
    // path + query (so Social stays on Social, ?tab=plans stays on plans).
    const newPath = location.pathname.replace(/^\/clients\/[^/]+/, `/clients/${newId}`);
    navigate(newPath + location.search);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={wrapRef} className="client-switcher">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="client-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch client"
      >
        <span className="client-switcher-label">
          {current?.name || 'Select client'}
        </span>
        <span className="client-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="client-switcher-menu" role="listbox">
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="client-switcher-search"
            aria-label="Search clients"
          />
          <div className="client-switcher-list">
            {filtered.length === 0 && (
              <div className="client-switcher-empty">No clients match.</div>
            )}
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => switchTo(c.id)}
                className={'client-switcher-item' + (c.id === clientId ? ' active' : '')}
                role="option"
                aria-selected={c.id === clientId}
              >
                <span>{c.name}</span>
                {c.id === clientId && <span className="client-switcher-tick">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

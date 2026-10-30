// One box over the whole product.
//
// Daniel: *"can we add a search icon up next to the settings and connectors?
// a search icon that when click opens a bigger bar? sometimes i want to find
// something and it would be easier to search now."*
//
// Two halves, deliberately answered in two different places.
//
// **Screens** are matched here, in the browser, against nav/sections.js. It
// already holds every screen in the product, so a round trip would buy nothing
// and a second list on the server would drift the first time one is renamed.
// They appear as you type, with no network wait.
//
// **Records** come from /api/search, debounced. Eight tables at once, scoped
// to the clients the login may see, which is worked out server-side from the
// session and never from anything sent with the request.
//
// A record opens the record, not the list it is in: the screen is addressed by
// the path and the record by `?open=<id>`, which hooks/useOpenRecord.js reads.
// What "open" means is the entity's own to say — five kinds have a view of one
// record and show it, recordings and assets have none so their row is scrolled
// to and marked, and a client result is already its own dashboard. A list of
// six did not need this; a list of two hundred is the case the search box is
// for.
//
// Keyboard: the whole list is one sequence, so up and down cross from the
// screens into the records without a second set of keys, and Enter opens
// whatever is highlighted. Escape closes. ⌘K from anywhere opens it, which is
// why it is mounted in Layout rather than in the client bar — the icon that
// opens it is agency-and-client-scoped, the shortcut is not.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { allScreens } from '../nav/sections';
import { matchScreens, screenWhere } from '../nav/screenSearch';
import { api } from '../utils/api';
import { OPEN_PARAM } from '../hooks/useOpenRecord';

const DEBOUNCE_MS = 220;

export default function GlobalSearch({ onClose, clientId = null, readOnly = false, canVisualise = false }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [clients, setClients] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // The ctx the panel gates its rows on, so search cannot find a screen the
  // nav would not show this login.
  //
  // With no client to open them against, the client-scoped screens drop out
  // entirely rather than being offered and then doing nothing: a row that
  // highlights, takes Enter and leaves you where you were is worse than a row
  // that was never there. `clientId` is the one in the URL or, outside a
  // client, the last one visited — Layout resolves it, since it already keeps
  // that for the Workspace link and a second reader of the same key is a
  // second convention to keep in step.
  const screens = useMemo(
    () => allScreens({ readOnly, canVisualise }).filter(s => clientId || s.scope !== 'client'),
    [readOnly, canVisualise, clientId],
  );
  const screenHits = useMemo(() => matchScreens(q, screens), [q, screens]);

  // Client names, so a record says whose it is. One fetch per open session of
  // the palette; the list is small and already cached by the switcher.
  useEffect(() => {
    if (clients.length) return;
    api.get('/clients').then(setClients).catch(() => {});
  }, [clients.length]);
  const clientName = useCallback(
    (id) => (clients.find(c => c.id === id) || {}).name || null,
    [clients],
  );

  // Focus on mount. Layout mounts this only while it is open, so there is no
  // state to clear: an earlier version rendered null when closed and reset the
  // query in an effect on `open`, which left one painted frame showing the
  // previous search before the effect ran. Unmounting is both simpler and has
  // no frame to get wrong.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Records, debounced. `live` drops a response that arrives after the term
  // moved on — typing "coverage" fires four queries and the slowest must not
  // be the one that paints.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRecords([]); setLoading(false); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(term)}`)
        .then(r => { if (live) { setRecords(r.results || []); setLoading(false); } })
        .catch(() => { if (live) { setRecords([]); setLoading(false); } });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  // One flat sequence for the keyboard, grouped only for the eye. Screens
  // first: they are instant and they are what "where is X" usually means.
  const groups = useMemo(() => {
    const out = [];
    if (screenHits.length) {
      out.push({ key: 'screens', label: 'Screens', items: screenHits.map(s => ({ kind: 'screen', s })) });
    }
    const byType = new Map();
    for (const r of records) {
      if (!byType.has(r.type)) byType.set(r.type, { key: r.type, label: r.label || r.type, items: [] });
      byType.get(r.type).items.push({ kind: 'record', r });
    }
    out.push(...byType.values());
    return out;
  }, [screenHits, records]);

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // The highlight stays in range as results change under it, rather than
  // pointing past the end of a list that just got shorter.
  useEffect(() => { setCursor(c => (flat.length ? Math.min(c, flat.length - 1) : 0)); }, [flat.length]);

  const go = useCallback((item) => {
    if (!item) return;
    if (item.kind === 'screen') {
      // Built the one way the panel builds it: the section's own base, plus
      // the slug. A client screen with no client in the URL has nowhere to go.
      const { section, slug, scope } = item.s;
      if (scope === 'client' && !clientId) return;
      navigate(`${section.base(clientId)}/${slug}`);
    } else {
      const { client_id, leaf, screen, opens, id } = item.r;
      // 'screen' means the screen is the record (a client's own dashboard), so
      // the id would say nothing the path does not.
      const q = opens && opens !== 'screen' ? `?${OPEN_PARAM}=${encodeURIComponent(id)}` : '';
      navigate(`/clients/${client_id}/${leaf}/${screen}${q}`);
    }
    onClose();
  }, [navigate, onClose, clientId]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => (flat.length ? (c + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => (flat.length ? (c - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[cursor]);
    }
  };

  // Keep the highlighted row visible when the keyboard moves it past the edge
  // of the scroll box.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('[data-cursor="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const typed = q.trim().length >= 2;
  let index = -1;

  return (
    <div className="search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-field">
          <SearchIcon />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search screens, clients, releases, coverage, campaigns, recordings…"
            aria-label="Search"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="search-esc">esc</kbd>
        </div>

        <div className="search-results" ref={listRef}>
          {!typed && (
            <p className="search-hint">
              Type at least two characters. Screens appear as you type; records come
              from every client you can see.
            </p>
          )}

          {typed && groups.map(g => (
            <div className="search-group" key={g.key}>
              <div className="search-group-head">{g.label}</div>
              {g.items.map(item => {
                index += 1;
                const i = index;
                return (
                  <button
                    type="button"
                    key={item.kind === 'screen' ? `s:${item.s.sectionKey}:${item.s.slug}` : `r:${item.r.type}:${item.r.id}`}
                    className={`search-row${i === cursor ? ' is-cursor' : ''}`}
                    data-cursor={i === cursor ? 'true' : undefined}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => go(item)}
                  >
                    {item.kind === 'screen' ? (
                      <>
                        <span className="search-row-title">{item.s.label}</span>
                        <span className="search-row-meta">{screenWhere(item.s)}</span>
                      </>
                    ) : (
                      <>
                        <span className="search-row-title">{item.r.title}</span>
                        <span className="search-row-meta">
                          {[clientName(item.r.client_id), item.r.subtitle].filter(Boolean).join(' · ')}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {typed && loading && !flat.length && <p className="search-hint">Searching…</p>}
          {typed && !loading && !flat.length && (
            <p className="search-hint">Nothing matching “{q.trim()}”.</p>
          )}
        </div>

        <div className="search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          {loading && flat.length > 0 && <span className="search-foot-loading">searching…</span>}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export { SearchIcon };

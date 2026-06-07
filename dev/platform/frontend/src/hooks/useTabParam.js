import { useSearchParams } from 'react-router-dom';

// URL-synced tab state — one shared structure across the whole app.
// Reads the active tab from ?tab=, writes it back on change (replace, so
// switching tabs doesn't pile up browser history), and validates against an
// optional allow-list, falling back to the default for unknown values.
// The default tab clears the param so the bare URL = the default view.
export function useTabParam(defaultKey, valid) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const tab = valid ? (valid.includes(raw) ? raw : defaultKey) : (raw || defaultKey);

  const setTab = (next) => setSearchParams(prev => {
    const p = new URLSearchParams(prev);
    if (next === defaultKey) p.delete('tab');
    else p.set('tab', next);
    return p;
  }, { replace: true });

  return [tab, setTab];
}

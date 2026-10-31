import { useEffect, useRef, useState } from 'react';

// useState that remembers its value in this browser.
//
// For per-person conveniences only: a remembered checkbox, a last-used
// setting, a collapsed panel. Anything that has to persist reliably, be shared
// between people, or be read back by the server belongs in the database.
//
// Two reasons this exists rather than another inline localStorage call. The
// pattern was already written eight times across the app, and two of those
// (the analyst's model picker and the approval page's reviewer name) called
// localStorage with no try/catch at all, which throws during render in a
// private window or wherever site data is blocked and takes the whole page
// with it. Every read and write here is guarded, and a storage that refuses
// simply means the default is used.
//
//   key      — the storage key, prefixed so OMI's keys are identifiable
//   initial  — the value used when nothing is stored, or storage refuses
//
// Values round-trip through JSON, so anything JSON can hold works and
// anything it cannot (a Set, a Date, a function) does not belong here.
export default function usePersistedState(key, initial) {
  const storageKey = `omi:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      // A key that has never been written reads as null, which is a legitimate
      // stored value, so the absence is checked rather than the parse.
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });

  // The first render has nothing new to save, and writing on mount would
  // persist the default for anyone who merely opened the page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)); }
    catch { /* a browser that refuses storage still gets a working page */ }
  }, [storageKey, value]);

  return [value, setValue];
}

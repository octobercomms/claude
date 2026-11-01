import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

// Asking for one value, in a way that cannot silently do nothing.
//
// Fourteen places in OMI called window.prompt(). I removed one of them from
// the Journalists delete and wrote the reason in the commit message: prompt()
// returns null without showing anything in some embedded views, so the code
// after it never runs and the button reads as broken. Having made that
// argument I left the other thirteen alone, which is the worst of both — the
// reasoning is on record and the behaviour is still live.
//
// The consequences were not evenly distributed:
//
//   "Name this campaign"        → no campaign, no message        (worst)
//   "Rename this tag everywhere"→ no rename, no message
//   "Send a test to which email"→ no test sent, no message
//   "Dismiss reason (optional)" → `?? ''`, so Escape dismissed anyway
//   clipboard fallbacks         → the link you were copying vanished
//
// One modal replaces all of them. It is a promise, so each call site keeps
// its shape: `const name = await ask({ ... })`, null when cancelled, exactly
// as prompt() claimed to behave and now actually does.

const Ctx = createContext(null);

export function PromptProvider({ children }) {
  const [req, setReq] = useState(null);
  const [value, setValue] = useState('');
  const resolver = useRef(null);
  const inputRef = useRef(null);

  const ask = useCallback((opts = {}) => {
    const o = typeof opts === 'string' ? { title: opts } : opts;
    setValue(o.defaultValue != null ? String(o.defaultValue) : '');
    setReq(o);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  function settle(v) {
    const r = resolver.current;
    resolver.current = null;
    setReq(null);
    setValue('');
    if (r) r(v);
  }

  // Cancel resolves null, the same contract prompt() has, so every call site
  // that already tested for null keeps working.
  const close = () => settle(null);
  const confirm = () => {
    const v = value;
    if (req?.required && !v.trim()) { inputRef.current?.focus(); return; }
    settle(v);
  };

  return (
    <Ctx.Provider value={ask}>
      {children}
      {req && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h3 className="h3" style={{ marginTop: 0 }}>{req.title}</h3>
            {req.detail && <p className="body-sm text-muted" style={{ marginTop: 'var(--s2)' }}>{req.detail}</p>}
            <div className="field" style={{ marginTop: 'var(--s4)' }}>
              {req.label && <label className="field-label">{req.label}</label>}
              {req.multiline ? (
                <textarea ref={inputRef} className="input" rows={4} autoFocus value={value}
                  placeholder={req.placeholder || ''}
                  onChange={e => setValue(e.target.value)} />
              ) : (
                <input ref={inputRef} className="input" autoFocus value={value}
                  type={req.type || 'text'} placeholder={req.placeholder || ''}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
                    if (e.key === 'Escape') { e.preventDefault(); close(); }
                  }} />
              )}
            </div>
            <div className="row" style={{ gap: 'var(--s2)', justifyContent: 'flex-end', marginTop: 'var(--s4)' }}>
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirm}
                disabled={!!req.required && !value.trim()}>
                {req.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// Returns ask({ title, label, detail, defaultValue, placeholder, required,
// multiline, type, confirmLabel }) → Promise<string|null>.
export function usePrompt() {
  const ask = useContext(Ctx);
  if (!ask) throw new Error('usePrompt needs a PromptProvider above it');
  return ask;
}

export default PromptProvider;

import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Session lives in an httpOnly cookie the browser sends automatically, so the
// token isn't readable here. The source of truth for "am I logged in" is
// whether /auth/me succeeds (the cookie authenticates it).
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Tidy up the pre-migration localStorage token — the session now lives in
    // an httpOnly cookie, so this key is dead weight in every existing browser.
    try { localStorage.removeItem('token'); } catch { /* ignore */ }
    // Raw fetch (not the api helper) so a 401 here doesn't trigger the global
    // redirect-to-login — on the login page that would loop.
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Called by LoginPage after a successful POST /auth/login (which set the
  // cookie server-side and returned the user).
  function login(u) {
    setUser(u);
  }

  function logout() {
    // Clear the cookie server-side; ignore failures (we still drop local state).
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

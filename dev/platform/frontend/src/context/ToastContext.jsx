import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '11px 18px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            color: 'white',
            background: t.type === 'error' ? '#c62828' : t.type === 'warning' ? '#e65100' : '#2e7d32',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            maxWidth: 360,
            lineHeight: 1.4,
            animation: 'slideUp 0.2s ease',
          }}>
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

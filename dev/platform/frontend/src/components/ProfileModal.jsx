import React, { useEffect, useState } from 'react';
import JournalistProfileBody from './JournalistProfileBody';
import OutletProfileBody from './OutletProfileBody';

// Opens a journalist or publication card in place (no navigation), so clicking a
// name in a table doesn't lose the reader's scroll position. `target` is
// { type: 'journalist' | 'outlet', id } or null (closed). onChanged fires after
// an edit or delete so the host can refresh whatever listed the entity.
export default function ProfileModal({ target, onClose, onChanged }) {
  const [t, setT] = useState(target);
  useEffect(() => { setT(target); }, [target]);

  // Close on Escape, and lock body scroll while open.
  useEffect(() => {
    if (!t) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [t, onClose]);

  if (!t) return null;
  const handleDeleted = () => { onChanged?.(); onClose?.(); };

  return (
    <div
      className="modal-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: 24, overflow: 'auto' }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 720, width: '100%', margin: 'auto', maxHeight: '92vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {t.type === 'journalist'
          ? <JournalistProfileBody id={t.id} mode="modal" onClose={onClose} onDeleted={handleDeleted} onSaved={onChanged} />
          : <OutletProfileBody id={t.id} mode="modal" onClose={onClose} onDeleted={handleDeleted} onSaved={onChanged} onOpenJournalist={(jid) => setT({ type: 'journalist', id: jid })} />}
      </div>
    </div>
  );
}

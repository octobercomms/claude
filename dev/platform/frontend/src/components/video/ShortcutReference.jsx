import React, { useCallback, useEffect, useRef } from 'react';

/**
 * Keyboard-shortcut reference panel for the composition editor.
 *
 * Toggle with the `?` key; close with Escape or clicking outside.
 * Reads every shortcut that Compositor.jsx and CompositionTimeline.jsx
 * actually handle, plus planned J/K/L playback-speed controls.
 */

const SHORTCUT_GROUPS = [
  {
    label: 'Playback',
    shortcuts: [
      { keys: ['Space'], desc: 'Play / Pause' },
      { keys: ['K'], desc: 'Pause' },
      // TODO: wire J/K/L variable-speed playback in Compositor.jsx
      { keys: ['J'], desc: 'Step backward' },
      { keys: ['L'], desc: 'Play forward' },
    ],
  },
  {
    label: 'Navigation',
    shortcuts: [
      { keys: ['←'], desc: 'Step back 1 frame' },
      { keys: ['→'], desc: 'Step forward 1 frame' },
      { keys: ['Shift', '←'], desc: 'Move playhead back 1 second' },
      { keys: ['Shift', '→'], desc: 'Move playhead forward 1 second' },
    ],
  },
  {
    label: 'Editing',
    note: 'Select an item on the timeline first',
    shortcuts: [
      { keys: ['S'], desc: 'Split item at playhead' },
      { keys: ['Delete'], desc: 'Remove selected item' },
      { keys: ['← / →'], desc: 'Nudge item by 0.1 s' },
      { keys: ['Shift', '← / →'], desc: 'Nudge item by 1 s' },
      { keys: ['Alt', '← / →'], desc: 'Trim item end' },
      { keys: ['Alt', 'Shift', '← / →'], desc: 'Trim item end by 1 s' },
      { keys: ['Escape'], desc: 'Cancel drag' },
    ],
  },
  {
    label: 'General',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo' },
      { keys: ['?'], desc: 'Toggle this shortcuts panel' },
    ],
  },
];

function Kbd({ children }) {
  return (
    <kbd style={{
      display: 'inline-block',
      padding: '1px 6px',
      fontSize: 'var(--fs-caption)',
      fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
      lineHeight: 1.4,
      color: 'var(--text)',
      background: 'var(--surface)',
      border: 'var(--border-w, 1px) solid var(--card-border)',
      borderRadius: 'var(--r-xs, 3px)',
      boxShadow: '0 1px 0 var(--card-border)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </kbd>
  );
}

export default function ShortcutReference({ visible, onClose }) {
  const panelRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    if (!visible) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible, onClose]);

  // Close on click outside
  const onBackdropClick = useCallback((e) => {
    if (panelRef.current && !panelRef.current.contains(e.target)) {
      onClose?.();
    }
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      onClick={onBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        padding: 'var(--s4)',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        style={{
          width: 340,
          maxWidth: '100%',
          maxHeight: 'calc(100vh - 120px)',
          overflowY: 'auto',
          background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: 'var(--border-w, 1px) solid var(--card-border)',
          borderRadius: 'var(--r-md)',
          boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          padding: 'var(--s4)',
          animation: 'shortcutSlideIn 150ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 'var(--s3)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-body)' }}>
            Keyboard shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts panel"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-subtle)', fontSize: 18, lineHeight: 1,
              padding: '2px 6px', borderRadius: 'var(--r-xs, 3px)',
            }}
          >
            &times;
          </button>
        </div>

        {/* Groups */}
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 'var(--s3)' }}>
            <div style={{
              fontSize: 'var(--fs-caption)', fontWeight: 600,
              color: 'var(--text-subtle)', textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 'var(--s1)',
            }}>
              {group.label}
            </div>
            {group.note && (
              <div style={{
                fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
                marginBottom: 'var(--s1)', fontStyle: 'italic',
              }}>
                {group.note}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.shortcuts.map((sc, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '3px 0',
                  opacity: sc.planned ? 0.55 : 1,
                }}>
                  <span style={{
                    fontSize: 'var(--fs-caption)', color: 'var(--text)',
                    flex: 1,
                  }}>
                    {sc.desc}
                    {sc.planned && (
                      <span style={{
                        marginLeft: 6, fontSize: '0.7rem',
                        color: 'var(--text-muted)', fontStyle: 'italic',
                      }}>
                        coming soon
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 'var(--s2)' }}>
                    {sc.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)', lineHeight: 1.4 }}>+</span>
                        )}
                        <Kbd>{k}</Kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{
          fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
          borderTop: 'var(--border-w, 1px) solid var(--card-border)',
          paddingTop: 'var(--s2)', marginTop: 'var(--s1)',
        }}>
          Press <Kbd>?</Kbd> to toggle this panel
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes shortcutSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Small "?" button for the editor toolbar that opens the shortcuts panel.
 */
export function ShortcutButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Keyboard shortcuts (?)"
      aria-label="Show keyboard shortcuts"
      className="btn-chip"
      style={{
        fontSize: 'var(--fs-caption)',
        fontWeight: 700,
        width: 26,
        height: 26,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--r-sm)',
        flexShrink: 0,
      }}
    >
      ?
    </button>
  );
}

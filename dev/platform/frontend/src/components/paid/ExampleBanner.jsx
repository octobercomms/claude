import React from 'react';

// Shown on every Build step when the active batch is the auto-generated
// worked example, so it's always obvious this isn't approved client work.
// The example is a real, persisted batch (it renders, approves and launches
// like any other) — this banner just labels it and points at how to make a
// real one.
export default function ExampleBanner({ onNewBrief }) {
  return (
    <div
      className="callout"
      style={{
        background: 'var(--accent-soft)', border: 'var(--border-w) solid var(--accent)',
        borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, minWidth: 0 }}>
        <span style={{ fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 11, marginRight: 8 }}>Example</span>
        A worked example built from this client's profile so you can see what each step produces — safe to show a client, and safe to delete.
        {' '}Create your own with <strong>+ New brief</strong>.
      </div>
      {onNewBrief && (
        <button className="btn btn-primary btn-sm" onClick={onNewBrief} style={{ whiteSpace: 'nowrap' }}>+ New brief</button>
      )}
    </div>
  );
}

import React from 'react';

export default function VatPanel() {
  return (
    <div className="card">
      <h2 className="caption">VAT</h2>
      <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
        VAT return preparation and exception tracking. Coming in Phase 2, once the reconciliation queue and rules engine are bedded in.
      </p>
      <div className="callout callout-accent" style={{ marginTop: 'var(--s2)' }}>
        This screen will pull your reconciled transactions for the VAT quarter, flag anything with ambiguous or missing tax codes, and produce a pack you can hand to Beany or submit directly.
      </div>
    </div>
  );
}

import React from 'react';

export default function DigestsPanel() {
  return (
    <div className="card">
      <h2 className="caption">Weekly digest</h2>
      <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
        Automated weekly reconciliation summary sent every Monday. Coming in Phase 2, after the scheduler and notification system are wired.
      </p>
      <div className="callout callout-accent" style={{ marginTop: 'var(--s2)' }}>
        The digest will cover: new unreconciled transactions pulled from Xero, auto-classified items awaiting review, missing invoices (amber after 7 days, red after 14), upcoming tax deadlines within 30 days, and FX movements across GBP/USD/EUR/CAD accounts.
      </div>
    </div>
  );
}

import React, { useState } from 'react';

// One ad account, or one roll-up of them, as a collapsible section.
//
// Falcon's Google Ads carries forty campaigns, most of them at £0.00, and the
// page opened with every one of them on screen. The numbers that answer "is
// this working" were four scrolls apart.
//
// The headline stays visible when it is shut. That is what makes "collapsed by
// default" safe rather than a second Health tab: you always see the money, you
// expand for the campaign-by-campaign detail. A section that hides its own
// summary is just a page that starts empty.
//
//   label     — the account's name, as typed on the connector
//   currency  — the ISO code that account reports, shown beside the label
//   stats     — the bento strip; always rendered, open or shut
//   note      — a currency note under the stats, when the backend sent one
//   children  — the detail, revealed on expand. No children, no toggle.
//   defaultOpen — for a section that is the only one there is
export default function AdAccountSection({ label, currency, stats, note, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = !!children;

  return (
    <section className="ad-acct">
      {(label || collapsible) && (
        <div className="ad-acct-head">
          <div className="ad-acct-name">
            {label && <span>{label}</span>}
            {/* The account's own billing currency, beside its own name.
                A section headed "US" showing £ reads as a bug; it is not.
                A connector label describes targeting and is free text, while
                the currency comes from the ad platform, and an account can
                target anywhere while billing in anything. Printing the code
                here is the difference between a wrong-looking number and an
                explained one. */}
            {currency && <span className="chip chip-neutral ad-acct-cur">{currency}</span>}
          </div>
          {collapsible && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}
              aria-expanded={open}>
              {open ? 'Hide campaigns' : 'Show campaigns'}
            </button>
          )}
        </div>
      )}

      {stats}
      {note && <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>{note}</p>}

      {collapsible && open && <div className="ad-acct-detail">{children}</div>}
    </section>
  );
}

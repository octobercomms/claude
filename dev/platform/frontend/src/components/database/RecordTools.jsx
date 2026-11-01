import React from 'react';

// The actions on a Database list: one primary, the rest beside it.
//
// This was a kebab opening a side drawer. "the drawer icon is completely the
// wrong place" — and once the Cleanup screens became rows in the Database
// panel, the drawer had one item left on Publications and two on Journalists.
// A menu holding one button is worse than the button.
//
// What the drawer was mostly for was the way in to Database tools, which was
// a page you could only reach from whichever list you happened to be on. That
// is the Cleanup group in the section panel now, so the way in is the nav,
// where a destination belongs.
//
// `primary` is the one thing you came to this screen to do and renders last,
// on the right. `children` are the secondary actions — export, import — which
// act on the list but are not why you opened it.
export default function RecordTools({ primary, children }) {
  const secondary = React.Children.toArray(children).filter(Boolean);
  if (!secondary.length) return primary || null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
      {secondary}
      {primary}
    </div>
  );
}

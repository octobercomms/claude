import React from 'react';

// ListDetail / Workbench (L5) — a list on the left, detail on the right. The
// shape behind transcripts, video projects, and (once lifted out of their
// modals) journalists, contacts, keywords and campaigns. Layout only; the
// parent owns list + selection state and passes the two sides as nodes.
//   sidebar — a fixed-width list column (a picker rail) instead of the
//             balanced two-pane split; use it when the left is a short list.
export default function ListDetail({ list, detail, sidebar = false }) {
  return (
    <div className={'ds-workbench' + (sidebar ? ' ds-workbench--sidebar' : '')}>
      {list}
      {detail}
    </div>
  );
}

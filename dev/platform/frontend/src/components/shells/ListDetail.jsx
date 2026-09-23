import React from 'react';

// ListDetail / Workbench (L5) — searchable list on the left, detail drawer on
// the right. The shape behind journalists, contacts, keywords, campaigns, leads
// and most Settings screens. Layout only; the parent owns list + selection
// state and passes the two sides as nodes.
export default function ListDetail({ list, detail }) {
  return (
    <div className="ds-workbench">
      {list}
      {detail}
    </div>
  );
}

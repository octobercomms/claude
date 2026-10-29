// The Clients page is assembled from two endpoints, and which one wins for
// which field is the whole correctness question. It lives here, pure, so the
// rule is written down once and checked by tests/clientList.test.mjs.
//
//   /clients   — the spine. The only endpoint that returns archived clients,
//                and the only one carrying `active`.
//   /dashboard — connectors, last_report, alerts, spend. Active clients only
//                (its query is `WHERE c.active = true`), so an archived client
//                is simply absent and carries no extras.
//
// The trap this guards: spreading the summary row over the spine row would let
// the summary's own stale `active` overwrite the spine's, and a client archived
// since the summary was built would come back as active.

export function mergeClientList(clients, summaryClients) {
  const byId = new Map((summaryClients || []).map(c => [c.id, c]));
  return (clients || []).map(c => ({ ...c, ...(byId.get(c.id) || {}), active: c.active }));
}

// Headline figures for the KPI strip. Connector health counts active clients
// only — an archived client has no connectors in the summary, so including it
// would only ever dilute the percentage with zeroes.
export function summariseClients(rows) {
  const list = rows || [];
  const active = list.filter(c => c.active);
  const connectors = active.flatMap(c => c.connectors || []);
  const connTotal = connectors.length;
  const connActive = connectors.filter(c => c.status === 'active').length;
  return {
    activeCount: active.length,
    archivedCount: list.length - active.length,
    connTotal,
    connActive,
    healthPct: connTotal ? Math.round((connActive / connTotal) * 100) : 0,
  };
}

export function filterClients(rows, filter) {
  return (rows || []).filter(c => {
    if (filter === 'active') return !!c.active;
    if (filter === 'archived') return !c.active;
    return true;
  });
}

export function autoSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

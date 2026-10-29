// Data.
//
// Reduced to one thing per audience. The Overview went with the rest of them
// in Oct 2026 — it described the section rather than doing anything — and
// Measure moved to the client Dashboard before that.
//
// What is left: the private analyst for the agency, and the client's own live
// numbers for a client login. That second branch is not decoration. Analyse
// has always been agency-only, so deleting the Overview without it would have
// left every client login staring at an empty page, and a client login is
// sent here by both ClientHomeDashboard and the Workspace nav item.
//
// The page is slated to disappear once the analyst becomes a side panel on
// every page. It stays until then because Analyse has nowhere else to live.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import ClientChatPage from './ClientChatPage';
import MeasurePanel from '../components/MeasurePanel';
import { useAuth } from '../context/AuthContext';

export default function ClientSalesTrafficPage() {
  const { id } = useParams();
  const { readOnly } = useAuth();
  const [client, setClient] = useState(null);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);

  return (
    <div className="suite-sales">
      <PageShell title="Data" subtitle={client?.name} tabs={[]}>
        {readOnly ? <MeasurePanel clientId={id} /> : <ClientChatPage embedded clientId={id} />}
      </PageShell>
    </div>
  );
}

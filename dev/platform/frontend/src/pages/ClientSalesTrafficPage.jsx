// Data — a client login's own numbers, and nothing else.
//
// This page has been emptying out all day. Measure moved to the client
// Dashboard, the Strategist moved to Strategy, the Overview was deleted, and
// the analyst became a panel available on every page. For the agency that
// leaves nothing: Data would be a nav item in front of a panel you can already
// open from anywhere, so an agency login is sent to the Dashboard instead.
//
// A client login still needs somewhere for their numbers. The Dashboard is the
// agency's workspace and closed to them, so this route stays as theirs, and
// "Data" means what it has always meant from their side: revenue, orders,
// traffic.

import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import MeasurePanel from '../components/MeasurePanel';
import { useAuth } from '../context/AuthContext';

export default function ClientSalesTrafficPage() {
  const { id } = useParams();
  const { readOnly } = useAuth();
  const [client, setClient] = useState(null);

  useEffect(() => {
    if (readOnly) api.get(`/clients/${id}`).then(setClient).catch(() => {});
  }, [id, readOnly]);

  if (!readOnly) return <Navigate to={`/clients/${id}?tab=measure`} replace />;

  return (
    <div className="suite-sales">
      <PageShell title="Data" subtitle={client?.name} tabs={[]}>
        <MeasurePanel clientId={id} />
      </PageShell>
    </div>
  );
}

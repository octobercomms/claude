import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import PageShell from '../components/shells/PageShell';
import PillarMeasure from '../components/PillarMeasure';
import ClarityCroPanel from '../components/ClarityCroPanel';
import FormsTab from '../components/FormsTab';
import ClientOutreachPage from './ClientOutreachPage';
import { useTabParam } from '../hooks/useTabParam';

// Convert — turning a visitor into a lead, and a lead into a reply.
//
// CRO, Forms and Email were group tabs inside Owned. Taxonomically that was
// right: traffic you own, converted on pages you own. Practically Owned had
// 29 SEO destinations and three more that had nothing to do with ranking, and
// the SEO work had no room to grow. These three are a different job on a
// different clock, so they get their own section beside the pillars.
//
// Sitting next to Paid/Earned/Shared/Owned without a chip, like Produce: the
// four pillars carry a chip because PESO needs translating, and these two do
// not because their names already say what they are.
export default function ClientConvertPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [tab] = useTabParam('cro', ['cro', 'forms', 'email']);

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch(() => {});
    // Forms needs the October Forms connector to know where to send a lead.
    api.get(`/connectors/client/${id}`)
      .then(r => setConnectors(Array.isArray(r) ? r : (r.connectors || [])))
      .catch(() => {});
  }, [id]);

  return (
    <div className="suite-convert">
      <PageShell title="Convert" subtitle={client?.name}>
        {/* What this work actually drove. Same three headline numbers as the
            pillars, filtered to the channels that bring a lead in. */}
        <PillarMeasure clientId={id} pillar="owned" />

        {tab === 'cro' && <ClarityCroPanel clientId={id} />}
        {tab === 'forms' && <FormsTab clientId={id} connectors={connectors} />}
        {/* Outreach runs its own ?etab=, which is why it is embedded rather
            than unpicked into rows here. */}
        {tab === 'email' && <ClientOutreachPage embedded clientId={id} />}
      </PageShell>
    </div>
  );
}

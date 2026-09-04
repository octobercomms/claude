import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import RecordingsPage from './RecordingsPage';
import ClientEditPage from './ClientEditPage';
import ClientVisualisePage from './ClientVisualisePage';
import TranscribePage from './TranscribePage';
import { useTabParam } from '../hooks/useTabParam';
import { useAuth } from '../context/AuthContext';

// Produce — the per-client media suite: Record (screen recorder + this client's
// video library), Edit (guided video editor) and Visualise (image studio).
// Clients see Record (view-only, their attached videos); Edit is agency-only;
// Visualise follows the can_use_visualise grant. See
// docs/omi/loom-replacement-plan.md.
export default function ClientVideoTab() {
  const { id } = useParams();
  const { readOnly, user } = useAuth();
  const canVisualise = !readOnly || !!user?.can_use_visualise;
  const [tab, setTab] = useTabParam('record', ['record', 'edit', 'visualise', 'transcribe']);
  const [client, setClient] = useState(null);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);
  // Edit is agency-only; Visualise needs the grant — bounce a client off a deep link.
  useEffect(() => {
    if (readOnly && (tab === 'edit' || tab === 'transcribe')) setTab('record');
    if (tab === 'visualise' && !canVisualise) setTab('record');
  }, [readOnly, canVisualise, tab, setTab]);

  return (
    <div>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Produce</span></div>
      <header className="hero"><div><h1 className="display mt-2">Produce</h1></div></header>

      <SuiteTabs tabs={[
        { key: 'record', label: 'Record', active: tab === 'record', onClick: () => setTab('record') },
        ...(readOnly ? [] : [{ key: 'edit', label: 'Edit', fn: 'create', active: tab === 'edit', onClick: () => setTab('edit') }]),
        ...(canVisualise ? [{ key: 'visualise', label: 'Visualise', fn: 'create', active: tab === 'visualise', onClick: () => setTab('visualise') }] : []),
        ...(readOnly ? [] : [{ key: 'transcribe', label: 'Transcribe', fn: 'create', active: tab === 'transcribe', onClick: () => setTab('transcribe') }]),
      ]} />

      {tab === 'record' && <RecordingsPage embedded clientId={id} onSendToEdit={() => setTab('edit')} />}
      {tab === 'edit' && !readOnly && <ClientEditPage embedded clientId={id} />}
      {tab === 'visualise' && canVisualise && <ClientVisualisePage embedded clientId={id} />}
      {tab === 'transcribe' && !readOnly && <TranscribePage embedded clientId={id} />}
    </div>
  );
}

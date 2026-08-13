import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import RecordingsPage from './RecordingsPage';
import ClientEditPage from './ClientEditPage';
import { useTabParam } from '../hooks/useTabParam';
import { useAuth } from '../context/AuthContext';

// Per-client Video workspace: records + this client's video library (Videos
// tab) and the guided editor (Edit tab). Clients (read-only) see only the
// Videos tab — their attached videos, view-only. Agency records, edits and
// attaches. See docs/omi/loom-replacement-plan.md.
export default function ClientVideoTab() {
  const { id } = useParams();
  const { readOnly } = useAuth();
  const [tab, setTab] = useTabParam('library', ['library', 'edit']);
  const [client, setClient] = useState(null);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);
  // Edit is agency-only — bounce a client login off a deep link.
  useEffect(() => { if (readOnly && tab === 'edit') setTab('library'); }, [readOnly, tab, setTab]);

  return (
    <div>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Video</span></div>
      <header className="hero"><div><h1 className="display mt-2">Video</h1></div></header>

      <SuiteTabs tabs={[
        { key: 'library', label: 'Videos', active: tab === 'library', onClick: () => setTab('library') },
        ...(readOnly ? [] : [{ key: 'edit', label: 'Edit', fn: 'create', active: tab === 'edit', onClick: () => setTab('edit') }]),
      ]} />

      {tab === 'library' && <RecordingsPage embedded clientId={id} />}
      {tab === 'edit' && !readOnly && <ClientEditPage embedded clientId={id} />}
    </div>
  );
}

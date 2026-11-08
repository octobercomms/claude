import React, { Suspense, useEffect, useState } from 'react';
import { lazyChunk } from '../utils/lazyChunk';
import ScreenHeading from '../components/ScreenHeading';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import RecordingsPage from './RecordingsPage';
import ClientVisualisePage from './ClientVisualisePage';
import TranscribePage from './TranscribePage';
import AudioPage from './AudioPage';
import AssetLibrary from '../components/AssetLibrary';
import CompositionEditorPage from './CompositionEditorPage';
import VideoBatchPage from './VideoBatchPage';
import VideoBatchReviewPage from './VideoBatchReviewPage';
const ClientDesignPage = lazyChunk('ClientDesignPage', () => import('./ClientDesignPage'));
import { useScreen } from '../hooks/useScreen';
import { useAuth } from '../context/AuthContext';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function ClientVideoTab() {
  useDocumentTitle('Produce');
  const { id } = useParams();
  const { readOnly, user } = useAuth();
  const canVisualise = !readOnly || !!user?.can_use_visualise;
  const [tab, setTab] = useScreen('produce');
  const [client, setClient] = useState(null);
  const [clientLoading, setClientLoading] = useState(true);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}).finally(() => setClientLoading(false)); }, [id]);
  useEffect(() => {
    if (readOnly && ['transcribe', 'design', 'audio', 'compose', 'batch', 'batch_review'].includes(tab)) setTab('record');
    if (tab === 'visualise' && !canVisualise) setTab('record');
  }, [readOnly, canVisualise, tab, setTab]);

  if (clientLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s10)', color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Produce</span></div>
      <header className="hero">
        <div>
          <h1 className="display mt-2">Produce</h1>
          <ScreenHeading title="Produce" />
        </div>
      </header>
      {tab === 'compose' && !readOnly && <CompositionEditorPage clientId={id} />}
      {tab === 'record' && <RecordingsPage clientId={id} onSendToEdit={() => setTab('compose')} />}
      {tab === 'design' && !readOnly && (
        <Suspense fallback={<div className="card" style={{ marginTop: 'var(--s4)' }}>Loading the editor…</div>}>
          <ClientDesignPage clientId={id} />
        </Suspense>
      )}
      {tab === 'visualise' && canVisualise && <ClientVisualisePage clientId={id} />}
      {tab === 'transcribe' && !readOnly && <TranscribePage clientId={id} />}
      {tab === 'audio' && !readOnly && <AudioPage clientId={id} />}
      {tab === 'batch' && !readOnly && <VideoBatchPage clientId={id} />}
      {tab === 'batch_review' && !readOnly && (
        <VideoBatchReviewPage clientId={id} onOpenInEditor={() => setTab('compose')} />
      )}
      {tab === 'library' && (
        <div className="card" style={{ marginTop: 'var(--s4)' }}>
          <AssetLibrary clientId={id} title="Everything made for this client" />
        </div>
      )}
    </div>
  );
}

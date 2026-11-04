import React, { Suspense, useEffect, useState } from 'react';
import { lazyChunk } from '../utils/lazyChunk';
import ScreenHeading from '../components/ScreenHeading';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import RecordingsPage from './RecordingsPage';
import ClientEditPage from './ClientEditPage';
import ClientVisualisePage from './ClientVisualisePage';
import TranscribePage from './TranscribePage';
import AudioPage from './AudioPage';
import MakeAReel from './MakeAReel';
import AssetLibrary from '../components/AssetLibrary';
import CompositionEditorPage from './CompositionEditorPage';
// Lazily loaded: the design editor pulls in Fabric.js, which is a large
// dependency that nobody who never opens this tab should be made to download.
// Reloads rather than showing a blank error when a deploy lands
// mid-session; see utils/lazyChunk.
const ClientDesignPage = lazyChunk('ClientDesignPage', () => import('./ClientDesignPage'));
import { useScreen } from '../hooks/useScreen';
import { useAuth } from '../context/AuthContext';
import useDocumentTitle from '../hooks/useDocumentTitle';

// Produce — the per-client media suite: Record (screen recorder + this client's
// video library), Edit (guided video editor) and Visualise (image studio).
// Clients see Record (view-only, their attached videos); Edit is agency-only;
// Visualise follows the can_use_visualise grant. See
// docs/omi/loom-replacement-plan.md.
export default function ClientVideoTab() {
  useDocumentTitle('Produce');
  const { id } = useParams();
  const { readOnly, user } = useAuth();
  const canVisualise = !readOnly || !!user?.can_use_visualise;
  const [tab, setTab] = useScreen('produce');
  const [client, setClient] = useState(null);
  const [clientLoading, setClientLoading] = useState(true);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}).finally(() => setClientLoading(false)); }, [id]);
  // Edit is agency-only; Visualise needs the grant — bounce a client off a deep link.
  useEffect(() => {
    if (readOnly && (tab === 'reel' || tab === 'edit' || tab === 'transcribe' || tab === 'design' || tab === 'audio' || tab === 'compose')) setTab('record');
    if (tab === 'visualise' && !canVisualise) setTab('record');
    if (tab === 'compose' && !user?.composition_editor) setTab('edit');
  }, [readOnly, canVisualise, tab, setTab, user?.composition_editor]);

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
      {tab === 'reel' && !readOnly && (
        <MakeAReel clientId={id} clientName={client?.name || ''} />
      )}
      {tab === 'record' && <RecordingsPage clientId={id} onSendToEdit={() => setTab('edit')} />}
      {tab === 'edit' && !readOnly && <ClientEditPage clientId={id} />}
      {tab === 'design' && !readOnly && (
        <Suspense fallback={<div className="card" style={{ marginTop: 'var(--s4)' }}>Loading the editor…</div>}>
          <ClientDesignPage clientId={id} />
        </Suspense>
      )}
      {tab === 'visualise' && canVisualise && <ClientVisualisePage clientId={id} />}
      {tab === 'transcribe' && !readOnly && <TranscribePage clientId={id} />}
      {tab === 'audio' && !readOnly && <AudioPage clientId={id} />}
      {tab === 'compose' && !readOnly && !!user?.composition_editor && <CompositionEditorPage clientId={id} />}
      {tab === 'library' && (
        <>
          <div className="card" style={{ marginTop: 'var(--s4)' }}>
            <AssetLibrary clientId={id} title="Everything made for this client"
              /* Picking an asset used to open Tighten and B-roll right here.
                 Both are steps in the Video flow now, and leaving them here as
                 well put one tool in two places, which is what the review
                 reported in the first place. Library lists what has been made;
                 the tools live where there is already a clip in hand. */ />
          </div>

        </>
      )}
    </div>
  );
}

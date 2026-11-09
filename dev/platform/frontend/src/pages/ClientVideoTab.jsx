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
  // Which composition the editor should open when something hands one over.
  // Null means "whatever the editor would have picked", which is the
  // behaviour for somebody opening the tab directly.
  const [openCompId, setOpenCompId] = useState(null);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}).finally(() => setClientLoading(false)); }, [id]);
  // No redirect any more, and this is the part that needed care.
  //
  // Produce is agency-only now, so there is no row a read-only client may be
  // sent to. The old `setTab('record')` cannot work: `useScreen`'s setTab
  // returns early when a tab has no row for this viewer, SILENTLY, so a client
  // who typed the URL would fall through to the `compose` branch, which is
  // gated on `!readOnly`, and get a blank page with the nav insisting they
  // were somewhere.
  //
  // So the section says what it is instead. Hiding the rail link hides
  // nothing from an address bar, a bookmark or an old email.
  if (readOnly) {
    return (
      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <h2 className="title">Produce is for the agency</h2>
        <p className="body-sm text-subtle" style={{ marginTop: 'var(--s2)' }}>
          This is where October makes your video, design and audio. You will see
          the work itself when we send it over for approval.
        </p>
      </div>
    );
  }

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
      {/* WHICH composition to open, not just which tab. Both handoffs into
          the editor used to switch the tab and nothing else, and the editor
          opens the first row of its own list — so "Send to Edit" and "Open in
          editor" landed on whatever was newest, which for the review sheet
          was reliably the wrong item. */}
      {tab === 'compose' && !readOnly && (
        // The client's name goes in, for the Share dialog's heading. A client
        // opening the link sees their own name and none of October's chrome,
        // so the person minting it should see whose link they are making.
        <CompositionEditorPage clientId={id} clientName={client?.name} openId={openCompId} />
      )}
      {tab === 'record' && (
        <RecordingsPage
          clientId={id}
          onSendToEdit={(compId) => { setOpenCompId(compId || null); setTab('compose'); }}
        />
      )}
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
        <VideoBatchReviewPage
          clientId={id}
          onOpenInEditor={(compId) => { setOpenCompId(compId || null); setTab('compose'); }}
        />
      )}
      {tab === 'library' && (
        <div className="card" style={{ marginTop: 'var(--s4)' }}>
          <AssetLibrary clientId={id} title="Everything made for this client" />
        </div>
      )}
    </div>
  );
}

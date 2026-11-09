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
import { useOpenState } from '../hooks/useOpenRecord';
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
  // WHICH reel the editor has open, in the address.
  //
  // This was component state, so a reel could not be linked, pasted into a
  // message or reached with Back, and a refresh landed on whatever the editor
  // would have picked. Every other record type in OMI reads its open record
  // from `?open=` — see the note on `useOpenState`, which describes this
  // situation while talking about press campaigns: "the id is not an
  // instruction, it is the address of what you are looking at".
  //
  // Null still means "whatever the editor would have picked", which is the
  // behaviour for somebody opening Produce directly.
  const [openCompId, setOpenCompId] = useOpenState();

  // One navigation, not two. `setTab` carries the search string it captured
  // at render, so setting `?open=` and then switching screens would drop the
  // parameter that had just been set.
  const openInStudio = (compId) => setTab('compose', compId ? `?open=${compId}` : '');

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
      {/* The Studio pays for its shelf out of this.
          Measured at 1440x900: the hero is 155px of a 900px screen, spent
          telling you the name of the section whose row is already lit in the
          panel beside it. The Studio is the one screen where the operator
          unambiguously knows where they are, and it is the one screen with no
          vertical to spare — the timeline is already near the fold, and a
          shelf that pushes it past is the regression the checks panel had.
          `ScreenHeading` stays, because the page is still the Produce page and
          `tests/sectionPanel.test.mjs` requires this file to render it; it is
          the display title and the kicker that go. */}
      {tab !== 'compose' && (
        <>
          <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Produce</span></div>
          <header className="hero">
            <div>
              <h1 className="display mt-2">Produce</h1>
              <ScreenHeading title="Produce" />
            </div>
          </header>
        </>
      )}
      {/* No ScreenHeading on the Studio. It rendered an h2 reading "Studio",
          naming the screen whose row is lit in the panel 170px away and under
          whose PRODUCE header it sat — and the editor's top bar now puts the
          name of the thing you are actually looking at in that slot. The
          heading stays on every other screen in this section. */}
      {/* WHICH composition to open, not just which tab. Both handoffs into
          the editor used to switch the tab and nothing else, and the editor
          opens the first row of its own list — so "Send to Edit" and "Open in
          editor" landed on whatever was newest, which for the review sheet
          was reliably the wrong item. */}
      {tab === 'compose' && !readOnly && (
        // The client's name goes in, for the Share dialog's heading. A client
        // opening the link sees their own name and none of October's chrome,
        // so the person minting it should see whose link they are making.
        <CompositionEditorPage clientId={id} clientName={client?.name}
          openId={openCompId} onOpen={setOpenCompId} />
      )}
      {tab === 'record' && (
        <RecordingsPage
          clientId={id}
          onSendToEdit={(compId) => openInStudio(compId)}
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
          onOpenInEditor={(compId) => openInStudio(compId)}
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

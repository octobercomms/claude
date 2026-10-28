import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import RecordingsPage from './RecordingsPage';
import ClientEditPage from './ClientEditPage';
import ClientVisualisePage from './ClientVisualisePage';
import TranscribePage from './TranscribePage';
import MakeAReel from './MakeAReel';
import AssetLibrary from '../components/AssetLibrary';
import TightenEdit from '../components/TightenEdit';
import BrollPlan from '../components/BrollPlan';
// Lazily loaded: the design editor pulls in Fabric.js, which is a large
// dependency that nobody who never opens this tab should be made to download.
const ClientDesignPage = lazy(() => import('./ClientDesignPage'));
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
  const [tab, setTab] = useTabParam('reel',
    ['reel', 'record', 'edit', 'design', 'visualise', 'transcribe', 'library']);
  const [client, setClient] = useState(null);
  // The clip the operator has picked out of the library to work on. Held here
  // rather than inside the library, because the library's job is to say what
  // exists and this is a tool pointed at one of those things.
  const [picked, setPicked] = useState(null);
  const [made, setMade] = useState(0);
  // The transcript for the picked clip, paid for once and shared by both
  // panels below.
  const [words, setWords] = useState(null);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);
  // Edit is agency-only; Visualise needs the grant — bounce a client off a deep link.
  useEffect(() => {
    if (readOnly && (tab === 'reel' || tab === 'edit' || tab === 'transcribe' || tab === 'design')) setTab('record');
    if (tab === 'visualise' && !canVisualise) setTab('record');
  }, [readOnly, canVisualise, tab, setTab]);

  return (
    <div>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Produce</span></div>
      <header className="hero"><div><h1 className="display mt-2">Produce</h1></div></header>

      <SuiteTabs tabs={[
        // First, and first on purpose. The tools that follow are the same
        // tools; this is the one route through them in the order a reel is
        // actually made, for an operator who should not have to know that
        // captions live in Edit and the cutting lives behind a thumbnail in
        // the Library.
        ...(readOnly ? [] : [{ key: 'reel', label: 'Make a reel', fn: 'create', active: tab === 'reel', onClick: () => setTab('reel') }]),
        { key: 'record', label: 'Record', active: tab === 'record', onClick: () => setTab('record') },
        ...(readOnly ? [] : [{ key: 'edit', label: 'Edit', fn: 'create', active: tab === 'edit', onClick: () => setTab('edit') }]),
        ...(readOnly ? [] : [{ key: 'design', label: 'Design', fn: 'create', active: tab === 'design', onClick: () => setTab('design') }]),
        ...(canVisualise ? [{ key: 'visualise', label: 'Visualise', fn: 'create', active: tab === 'visualise', onClick: () => setTab('visualise') }] : []),
        ...(readOnly ? [] : [{ key: 'transcribe', label: 'Transcribe', fn: 'create', active: tab === 'transcribe', onClick: () => setTab('transcribe') }]),
        // Not a tool. Everything the other five have made, in one place, which
        // is what lets another section offer it instead of producing it again.
        { key: 'library', label: 'Library', active: tab === 'library', onClick: () => setTab('library') },
      ]} />

      {tab === 'reel' && !readOnly && (
        <MakeAReel clientId={id} clientName={client?.name || ''} />
      )}
      {tab === 'record' && <RecordingsPage embedded clientId={id} onSendToEdit={() => setTab('edit')} />}
      {tab === 'edit' && !readOnly && <ClientEditPage embedded clientId={id} />}
      {tab === 'design' && !readOnly && (
        <Suspense fallback={<div className="card" style={{ marginTop: 'var(--s4)' }}>Loading the editor…</div>}>
          <ClientDesignPage embedded clientId={id} />
        </Suspense>
      )}
      {tab === 'visualise' && canVisualise && <ClientVisualisePage embedded clientId={id} />}
      {tab === 'transcribe' && !readOnly && <TranscribePage embedded clientId={id} />}
      {tab === 'library' && (
        <>
          <div className="card" style={{ marginTop: 'var(--s4)' }}>
            <AssetLibrary clientId={id} title="Everything made for this client"
              refreshKey={made}
              onPick={readOnly ? null : (a) => {
                setPicked(a.kind === 'video' ? a : null);
                setWords(null);          // a different clip, a different transcript
              }} />
            {!readOnly && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)',
                marginTop: 'var(--s3)' }}>
                Pick a video to take the pauses and the fillers out of it.
              </div>
            )}
          </div>

          {picked && !readOnly && (
            <div className="card" style={{ marginTop: 'var(--s3)' }}>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)',
                marginBottom: 'var(--s2)' }}>
                {picked.title || 'Untitled'}
                <button type="button" onClick={() => setPicked(null)}
                  style={{ background: 'none', border: 0, padding: 0, marginLeft: 8,
                    cursor: 'pointer', color: 'inherit', textDecoration: 'underline',
                    fontSize: 'inherit' }}>
                  pick another
                </button>
              </div>
              {/* Keyed on the asset so switching clips clears the previous
                  proposal. A plan from one video shown against another is the
                  kind of mistake that renders before anyone notices. */}
              {/* The selection is deliberately kept after a render. Clearing it
                  unmounted the panel along with the one line that said what had
                  just happened, so an operator pressed go, waited, and watched
                  the whole thing disappear without a word. */}
              <TightenEdit key={picked.id} asset={picked} onWords={setWords}
                onTightened={() => setMade((n) => n + 1)} />

              {/* Cutting the dead air and planning the cutaways are the same
                  sitting: both run on the transcript, and an operator who has
                  just tightened a clip is looking at exactly the thing that
                  wants b-roll. */}
              <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)',
                borderTop: 'var(--border-w) solid var(--card-border)' }}>
                <BrollPlan key={`broll-${picked.id}`} asset={picked} clientId={id}
                  words={words} onRendered={() => setMade((n) => n + 1)} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

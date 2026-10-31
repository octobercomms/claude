import React, { useState } from 'react';
import PipelineStep from '../organic/PipelineStep';
import NoBriefYet from './NoBriefYet';
import ExampleBanner from './ExampleBanner';
import { api } from '../../utils/api';
import { unstoredItems } from '../../utils/storedMedia';
import { useToast } from '../../context/ToastContext';

// Paid Pipeline → Launch. The hand-off to Ads Manager.
//
// This page used to say "manual export with the pre-launch checklist" and
// then show a checklist and a card promising direct API launch at some
// point. There was no export. Daniel, reading it: "we haven't connected
// anything, so perhaps this is a way to download all ad creative and a
// spreadsheet of copy? So it can be built manually?" — which is what the
// page already claimed to be.
//
// It is that now. One zip: copy.csv plus every rendered asset, named so a
// row in the sheet and a file in the folder match. The roadmap card is gone;
// a promise inside a product is an apology, and nothing is lost by making
// the page describe only what it does.
//
// The checklist stays. It is five things an AM forgets at 6pm and it costs
// nothing to print.
const CHECKLIST = [
  'Client has approved the batch',
  'Headlines fit the platform\'s character limits',
  'Final images are sized 1:1, 4:5 and 9:16',
  'Tracking pixel and UTM scheme confirmed for the campaign',
  'Daily budget and bid strategy agreed with client',
];

export default function PaidLaunchStep({ pipeline, onBack, clientId }) {
  const { activeBatch, creatives } = pipeline;
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState(null);
  const totalImages = (creatives || []).reduce((sum, c) => sum + ((c.images || []).length), 0);

  // Assets still on a provider's CDN. Anything generated from now on is kept
  // here at the moment it is made; a row from before that still points at
  // Ideogram or Replicate, and those links expire within hours or days. The
  // ones whose links are still alive can be kept, and this is the only
  // chance: nothing recovers a dead one.
  const unkept = unstoredItems((creatives || []).flatMap(c => c.images || []));

  // Fetched rather than linked. A plain <a download> would authenticate
  // perfectly well — the session is an httpOnly cookie and this is
  // same-origin — but it cannot read the response headers, and those carry
  // how many assets made it into the zip and how many did not.
  async function download() {
    setDownloading(true);
    try {
      const { blob, filename, missing, assets } = await api.download(
        `/ad-creatives/batches/${activeBatch.id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'ads.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (missing > 0) {
        // Said out loud, not buried in the zip. Anything missing is a row
        // from before assets were kept here, whose provider link has since
        // expired — which is what the button below exists to prevent on the
        // batches where it has not happened yet.
        toast(`${assets} asset${assets === 1 ? '' : 's'} downloaded, ${missing} missing — see MISSING.txt in the zip.`, 'warning');
      } else {
        toast(`Downloaded ${assets} asset${assets === 1 ? '' : 's'} and the copy sheet.`, 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally { setDownloading(false); }
  }

  async function keepOlder() {
    setKeeping(true);
    try {
      const out = await api.post(`/ad-creatives/clients/${clientId}/images/backfill`, {});
      setKept(out);
      if (out.stored > 0) {
        toast(`Kept ${out.stored} asset${out.stored === 1 ? '' : 's'} here.`, 'success');
        // The rows changed underneath the page, so what it is showing is now
        // stale in exactly the way that matters: the count of what is left.
        pipeline.refresh?.({ fresh: true });
      } else {
        toast(out.expired
          ? (out.expired === 1
            ? 'None could be kept — that link has expired.'
            : `None could be kept — all ${out.expired} links have expired.`)
          : 'Nothing left to keep.', out.expired ? 'warning' : 'info');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally { setKeeping(false); }
  }

  return (
    <PipelineStep
      num={5} title="Launch"
      tagline="Download the batch and build it in Ads Manager: every rendered asset plus a spreadsheet of the copy, matched by filename."
      banner={activeBatch?.is_example ? <ExampleBanner onNewBrief={onBack} /> : null}
    >
      {!activeBatch ? (
        <NoBriefYet what="This step packages a finished batch — assets and copy — for building the campaign by hand." onBack={onBack} />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="caption mb-2">Ready to ship</div>
            <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6, marginBottom: 'var(--s4)' }}>
              {creatives.length} concept{creatives.length === 1 ? '' : 's'} · {totalImages} rendered asset{totalImages === 1 ? '' : 's'}
            </div>
            <button className="btn btn-primary" onClick={download} disabled={downloading}>
              {downloading ? 'Packaging…' : '↓ Download batch'}
            </button>
            <p className="body-xs text-subtle" style={{ marginTop: 'var(--s2)', maxWidth: 560, lineHeight: 1.5 }}>
              A .zip holding <code>copy.csv</code> — headline, body, CTA, framework, angle and visual
              concept, one row per asset — and a <code>creative/</code> folder of the images and
              video. The File column names the file each row belongs to.
            </p>
            {totalImages === 0 && (
              <p className="body-sm text-muted" style={{ marginTop: 'var(--s3)' }}>
                Nothing rendered on this batch yet, so the zip will hold the copy sheet alone.
                Render first if you want the assets with it.
              </p>
            )}
          </div>

          {unkept.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--s4)' }}>
              <div className="caption mb-2">Keep a copy of older creative</div>
              <p className="body-sm" style={{ lineHeight: 1.6, marginBottom: 'var(--s3)', maxWidth: 620 }}>
                {unkept.length} asset{unkept.length === 1 ? '' : 's'} on this client still
                {unkept.length === 1 ? ' points' : ' point'} at the generator that made
                {unkept.length === 1 ? ' it' : ' them'} rather than at a copy here. Those links
                expire, which is why an old batch can export short. This keeps the ones that
                still work; the rest are already gone and nothing brings them back.
              </p>
              <button className="btn" onClick={keepOlder} disabled={keeping || !clientId}>
                {keeping ? 'Keeping…' : `Keep ${unkept.length} asset${unkept.length === 1 ? '' : 's'}`}
              </button>
              {kept && (
                <p className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
                  {kept.stored} kept{kept.expired ? `, ${kept.expired} already expired` : ''}
                  {kept.more ? ' — run it again for the rest' : ''}.
                </p>
              )}
            </div>
          )}

          <div className="card">
            <div className="caption mb-3">Before you set it live</div>
            <ul style={{ margin: 0, padding: '0 0 0 var(--s5)', fontSize: 'var(--fs-body)', lineHeight: 1.8 }}>
              {CHECKLIST.map((label, i) => <li key={i} style={{ color: 'var(--text)' }}>{label}</li>)}
            </ul>
          </div>
        </>
      )}
    </PipelineStep>
  );
}

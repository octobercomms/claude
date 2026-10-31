import React, { useState } from 'react';
import PipelineStep from '../organic/PipelineStep';
import NoBriefYet from './NoBriefYet';
import ExampleBanner from './ExampleBanner';
import { api } from '../../utils/api';
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

export default function PaidLaunchStep({ pipeline, onBack }) {
  const { activeBatch, creatives } = pipeline;
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const totalImages = (creatives || []).reduce((sum, c) => sum + ((c.images || []).length), 0);

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
        // Said out loud, not buried in the zip. A generated image is stored
        // as a link to the provider that made it and those links expire, so
        // an old batch can export with assets missing and look complete.
        toast(`${assets} asset${assets === 1 ? '' : 's'} downloaded, ${missing} missing — see MISSING.txt in the zip.`, 'warning');
      } else {
        toast(`Downloaded ${assets} asset${assets === 1 ? '' : 's'} and the copy sheet.`, 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally { setDownloading(false); }
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

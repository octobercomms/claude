// Mint a client approval link for a batch of ads.
//
// This was a pipeline step, which Daniel read correctly: "the page just looks
// empty. Do we just remove this step and add a button to copy client approval
// link like we have for coverage?"
//
// It looked empty because it was: a three-line summary and one button, on a
// full-width page, between two steps that do real work. And a step implies a
// decision — something to get right before moving on — where this has none.
// You press it and you get a URL. That is a button.
//
// Moving it to the header also fixes something the step could not. The step
// shared whatever batch happened to be selected, and never said which, so the
// only way to know what a client was about to see was to walk back through
// the pipeline. This names the batch, and offers the others.

import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

function describe(b) {
  const when = new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const brief = (b.brief || '').trim();
  const short = brief.length > 60 ? brief.slice(0, 59) + '…' : brief;
  return `${when} · ${b.creative_count} concept${b.creative_count === 1 ? '' : 's'}${short ? ` · ${short}` : ''}`;
}

export default function ApprovalLinkModal({ clientId, clientName, onClose }) {
  const toast = useToast();
  const [batches, setBatches] = useState(null);
  const [chosen, setChosen] = useState('');
  const [url, setUrl] = useState(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/ad-creatives/clients/${clientId}/batches`)
      .then(bs => {
        if (cancelled) return;
        // Real briefs only. A worked example is seeded from the client's own
        // profile and badged everywhere inside the platform, but a client
        // opening a public link has none of that context and would read it
        // as work done for them.
        const real = (bs || []).filter(b => !b.is_example);
        setBatches(real);
        if (real.length) setChosen(real[0].id);
      })
      .catch(e => { if (!cancelled) { setBatches([]); toast(e.message, 'error'); } });
    return () => { cancelled = true; };
  }, [clientId, toast]);

  async function mint() {
    setMinting(true);
    try {
      const { public_url } = await api.post(`/approvals/clients/${clientId}/links`, {
        scope: 'ad_creative_batch',
        scope_id: chosen,
        title: `Ad creative — ${clientName} ${new Date().toLocaleDateString('en-GB')}`,
        expires_days: 14,
      });
      setUrl(public_url);
    } catch (e) { toast(`Could not generate the link: ${e.message}`, 'error'); }
    finally { setMinting(false); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { toast('Copy failed — select the link and copy it by hand.', 'error'); }
  }

  const batch = (batches || []).find(b => b.id === chosen);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2" style={{ margin: 0 }}>Client approval link</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {batches === null ? (
          <div className="text-subtle body-sm">Loading…</div>
        ) : !batches.length ? (
          <p className="body-sm text-muted">
            No ad batches yet. Write a brief and generate some concepts first — the link shares
            a batch, so there has to be one.
          </p>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="approval-batch">Which batch</label>
              <select id="approval-batch" className="select" value={chosen}
                onChange={e => { setChosen(e.target.value); setUrl(null); }}>
                {batches.map(b => <option key={b.id} value={b.id}>{describe(b)}</option>)}
              </select>
            </div>

            <p className="body-sm text-muted" style={{ lineHeight: 1.55 }}>
              The client opens this without a login and approves or asks for changes on each
              concept. They see the copy and every rendered image, laid out as it would appear
              on the platform it is going to. The link stops working after 14 days.
            </p>

            {!url ? (
              <div className="row end mt-5" style={{ gap: 'var(--s2)' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={mint} disabled={minting || !chosen}>
                  {minting ? 'Generating…' : 'Generate link'}
                </button>
              </div>
            ) : (
              <>
                <div className="field" style={{ marginTop: 'var(--s4)' }}>
                  <label className="field-label">Link{batch ? ` for ${describe(batch)}` : ''}</label>
                  <div className="row" style={{ gap: 'var(--s2)' }}>
                    <input className="input" readOnly value={url} onFocus={e => e.target.select()}
                      style={{ flex: 1, fontFamily: 'monospace' }} />
                    <button type="button" className="btn btn-primary" onClick={copy}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="row end mt-5" style={{ gap: 'var(--s2)' }}>
                  {/* A second link for the same batch is a new token, which
                      is occasionally what you want (the first went to the
                      wrong person) and never automatic. */}
                  <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }}
                    onClick={() => { setUrl(null); }}>Generate another</button>
                  <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">Open it</a>
                  <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Give a client a link to a finished reel.
//
// The brief recorded Share as "a backend story. Do not ship the button ahead
// of the thing", which was wrong on the facts and is corrected there. The
// thing has existed since migration 027, which is named `video_audio_approval`
// and has been carrying social posts and ad creatives: an opaque token, a
// logged-out client view, per-item approve / request changes / comment, and a
// file proxy that already streams `uploads/<client>/…` to a reviewer with no
// login — which is exactly where a composition render is written.
//
// What a link carries is RENDERS, not the composition, and that is the point.
// A composition keeps being edited. A render is the file that was actually
// made. Share the composition and the thing approved on Tuesday is not the
// thing seen on Thursday, with nothing recording the difference.
//
// So the dialog lists finished renders rather than offering to share "this
// reel": if the last export was before the edit you just made, you should see
// that and export again before sending it.

import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

function when(r) {
  if (!r.finished_at) return `Render ${r.id}`;
  const d = new Date(r.finished_at);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function ShareReelModal({ compId, clientId, clientName, title, onClose }) {
  const toast = useToast();
  const [renders, setRenders] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [url, setUrl] = useState(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/compose/compositions/${compId}/renders`)
      .then(({ renders: rs }) => {
        if (cancelled) return;
        const list = rs || [];
        setRenders(list);
        // The newest, pre-ticked. It is what somebody who just pressed Export
        // means by "share this", and leaving nothing ticked would make the
        // common case two clicks for no decision.
        if (list.length) setChosen([list[0].id]);
      })
      .catch(e => { if (!cancelled) { setRenders([]); toast(e.message, 'error'); } });
    return () => { cancelled = true; };
  }, [compId, toast]);

  async function mint() {
    setMinting(true);
    try {
      const { public_url } = await api.post(`/approvals/clients/${clientId}/links`, {
        scope: 'render_list',
        render_ids: chosen,
        title: `${title || 'Reel'} — for your review`,
        expires_days: 30,
      });
      setUrl(public_url);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setMinting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations, and the
      // link is on screen and selectable either way, so this says what to do
      // rather than reporting a failure the person cannot act on.
      toast('Select the link and copy it.', 'info');
    }
  }

  const toggle = (id) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Share with the client">
        <div className="row between center">
          <h3 className="title">Share with {clientName || 'the client'}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">×</button>
        </div>

        {renders === null && <div className="text-subtle mt-4">Looking for finished reels…</div>}

        {renders?.length === 0 && (
          <div className="mt-4">
            <p className="body-sm">
              Nothing to share yet. A link carries the file that was rendered rather
              than the edit, so this composition needs an export first.
            </p>
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {!!renders?.length && !url && (
          <div className="mt-4">
            <div className="caption text-subtle">Which exports to share</div>
            <div style={{ display: 'grid', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              {renders.map((r, i) => (
                <label key={r.id} className="row center" style={{ gap: 'var(--s2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className="body-sm">{when(r)}</span>
                  {i === 0 && <span className="chip chip-neutral">Latest</span>}
                </label>
              ))}
            </div>
            <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>
              The link works without a login and expires in 30 days. Your client can
              approve, ask for changes, or leave a note on each reel.
            </p>
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
              <button type="button" className="btn btn-primary btn-sm"
                onClick={mint} disabled={minting || !chosen.length}>
                {minting ? 'Making the link…' : 'Make the link'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {url && (
          <div className="mt-4">
            <div className="caption text-subtle">Send them this</div>
            <input className="input mt-2" readOnly value={url}
              onFocus={e => e.target.select()} />
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                See what they see
              </a>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

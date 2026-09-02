// Unified "+ New campaign" entry point for Owned → Email. One button opens
// this; the lane picker chooses which prospecting engine to start:
//   bulk      — cold email from your own contact list. Creates the campaign
//               and opens CampaignWizard.
//   selective — AI sources + fit-scores prospects, you approve each. Hands off
//               to the Selective tab (its own engine + sending identity) where
//               the AM names the campaign and sets the ICP.
//
// Press releases are NOT started here — they live in Earned → Pitch.

import React, { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

export default function NewCampaignModal({ clientId, onClose, onCreated, onPickSelective }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [lane, setLane] = useState('bulk');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (lane === 'selective') {
        // Selective is a separate engine — hand off to its lane.
        onPickSelective?.();
        return;
      }
      const c = await api.post('/outreach/campaigns', {
        client_id: clientId,
        name: name.trim() || 'Untitled campaign',
        campaign_type: 'outreach',
      });
      onCreated?.(c);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2 className="h2">New campaign</h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="field">
          <label className="field-label">How do you want to prospect?</label>
          <select className="input" value={lane} onChange={e => setLane(e.target.value)}>
            <option value="bulk">Bulk outreach — cold email from your list</option>
            <option value="selective">Selective — AI sources them, you approve each</option>
          </select>
        </div>

        {lane === 'bulk' && (
          <div className="field">
            <label className="field-label">Campaign name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. ADF 2026 Tour Submissions" autoFocus />
          </div>
        )}

        {lane === 'selective' && (
          <p className="body-xs text-muted mt-2">
            AI researches and fit-scores prospects and drafts each message — you approve every prospect and every send.
            It runs from a dedicated sending identity, separate from your main email. We'll take you to the Selective
            lane to name the campaign and set the ICP.
          </p>
        )}

        <div className="row end mt-5">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '…' : (lane === 'selective' ? 'Continue →' : 'Create campaign')}
          </button>
        </div>
      </form>
    </div>
  );
}

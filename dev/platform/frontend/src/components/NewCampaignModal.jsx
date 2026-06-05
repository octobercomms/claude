// Unified "+ New campaign" entry point. One button on the Email page
// opens this; the campaign-type dropdown picks the flow:
//   outreach      — creates the campaign and opens CampaignWizard
//   press_release — collects the URL, hands off to PressCampaignWizard
//                   with the URL pre-fetched

import React, { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

export default function NewCampaignModal({ clientId, onClose, onCreated, onPickPress }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState('outreach');
  const [pressUrl, setPressUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (type === 'press_release') {
        if (!pressUrl.trim()) {
          toast('Press release URL is required.', 'error');
          setBusy(false); return;
        }
        // Hand off to the press wizard with the URL — it'll auto-fetch
        // the parsed preview and save creates both the release row +
        // the press_release campaign.
        onPickPress?.(pressUrl.trim());
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
          <label className="field-label">Campaign type</label>
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            <option value="outreach">Outreach — cold email sequence</option>
            <option value="press_release">Press release — pitch journalists</option>
          </select>
        </div>

        {type === 'outreach' && (
          <div className="field">
            <label className="field-label">Campaign name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. ADF 2026 Tour Submissions" autoFocus />
          </div>
        )}

        {type === 'press_release' && (
          <div className="field">
            <label className="field-label">Press release URL</label>
            <input className="input" value={pressUrl} onChange={e => setPressUrl(e.target.value)}
              placeholder="https://downloadfor.press/press-releases/your-release-slug/"
              autoFocus />
            <p className="body-xs text-muted mt-2">
              We'll fetch the page, preview the parsed release, and stage a 4-step pitch sequence on save.
            </p>
          </div>
        )}

        <div className="row end mt-5">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '…' : (type === 'press_release' ? 'Continue →' : 'Create campaign')}
          </button>
        </div>
      </form>
    </div>
  );
}

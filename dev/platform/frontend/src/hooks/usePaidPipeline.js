// Shared workflow state for the Paid Pipeline (Brief → Concepts → Render
// → Approve → Launch). Hoisted out of AdCreativePanel so each of the
// pipeline's five step panels can render a focused view of the same
// in-flight batch + concepts + share-for-approval state without
// duplicating fetches.
//
// Mount once at the parent (PaidPipelinePanel) and pass the returned
// object down to each step. Sub-tab navigation between steps is
// instantaneous because the state lives above the tab boundary.

import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

export function usePaidPipeline({ clientId, clientName }) {
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [assets, setAssets] = useState([]);
  const [showBrief, setShowBrief] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    try {
      const [bs, as] = await Promise.all([
        api.get(`/ad-creatives/clients/${clientId}/batches`),
        api.get(`/brand/clients/${clientId}/assets`),
      ]);
      setBatches(bs);
      setAssets(as);
      if (bs.length && !activeBatchId) {
        setActiveBatchId(bs[0].id);
        const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${bs[0].id}`);
        setCreatives(cs);
      }
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function selectBatch(batchId) {
    setActiveBatchId(batchId);
    const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${batchId}`);
    setCreatives(cs);
  }

  async function generate(payload) {
    setGenerating(true);
    try {
      const { batch, creatives: newCreatives } = await api.post(`/ad-creatives/clients/${clientId}/generate`, payload);
      setBatches(prev => [batch, ...prev]);
      setActiveBatchId(batch.id);
      const cs = await api.get(`/ad-creatives/clients/${clientId}/creatives?batch_id=${batch.id}`);
      setCreatives(cs);
      setShowBrief(false);
      toast(`Generated ${newCreatives.length} ad concepts.`, 'success');
    } catch (e) {
      toast(`Generation failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function deleteCreative(creativeId) {
    if (!confirm('Delete this concept?')) return;
    try {
      await api.delete(`/ad-creatives/creatives/${creativeId}`);
      setCreatives(prev => prev.filter(c => c.id !== creativeId));
    } catch (e) { toast(`Delete failed: ${e.message}`, 'error'); }
  }

  async function updateCreative(creativeId, partial) {
    try {
      const updated = await api.put(`/ad-creatives/creatives/${creativeId}`, partial);
      setCreatives(prev => prev.map(c => c.id === creativeId ? { ...c, ...updated } : c));
      return updated;
    } catch (e) { toast(`Update failed: ${e.message}`, 'error'); }
  }

  async function deleteBatch(batchId) {
    if (!confirm('Delete this batch and all its concepts?')) return;
    try {
      await api.delete(`/ad-creatives/batches/${batchId}`);
      const next = batches.filter(b => b.id !== batchId);
      setBatches(next);
      if (next[0]) selectBatch(next[0].id);
      else { setActiveBatchId(null); setCreatives([]); }
    } catch (e) { toast(`Delete failed: ${e.message}`, 'error'); }
  }

  async function renderImages(creativeId, payload) {
    try {
      const { images } = await api.post(`/ad-creatives/creatives/${creativeId}/images`, payload);
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: [...(c.images || []), ...images.filter(i => !i.error)] }
        : c));
      const errors = images.filter(i => i.error);
      if (errors.length) toast(`Some renders failed: ${errors.map(e => `${e.aspect_ratio}: ${e.error}`).join('; ')}`, 'error');
    } catch (e) { toast(`Image render failed: ${e.message}`, 'error'); }
  }

  async function deleteImage(imageId, creativeId) {
    try {
      await api.delete(`/ad-creatives/images/${imageId}`);
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: (c.images || []).filter(i => i.id !== imageId) }
        : c));
    } catch (e) { toast(`Could not delete: ${e.message}`, 'error'); }
  }

  async function shareBatchForApproval() {
    if (!activeBatchId) return;
    try {
      const { public_url } = await api.post(`/approvals/clients/${clientId}/links`, {
        scope: 'ad_creative_batch',
        scope_id: activeBatchId,
        title: `Ad creative — ${clientName} ${new Date().toLocaleDateString('en-GB')}`,
        expires_days: 14,
      });
      setShareUrl(public_url);
    } catch (e) { toast(`Could not generate link: ${e.message}`, 'error'); }
  }

  async function fanOutImage(imageId, creativeId) {
    try {
      const { generated } = await api.post(`/ad-creatives/images/${imageId}/fan-out`, {
        aspect_ratios: ['1:1', '4:5', '9:16', '16:9'],
      });
      const added = generated.filter(g => !g.error && g.id);
      setCreatives(prev => prev.map(c => c.id === creativeId
        ? { ...c, images: [...(c.images || []), ...added] }
        : c));
      const errs = generated.filter(g => g.error);
      if (errs.length) toast(`Some sizes failed: ${errs.map(e => `${e.aspect_ratio}: ${e.error}`).join('; ')}`, 'error');
      else toast(`Fanned out to ${added.length} new sizes via Adobe.`, 'success');
    } catch (e) { toast(`Fan-out failed: ${e.message}`, 'error'); }
  }

  const activeBatch = batches.find(b => b.id === activeBatchId) || null;

  return {
    batches, creatives, activeBatchId, activeBatch, assets, loaded,
    showBrief, setShowBrief,
    generating, shareUrl, setShareUrl,
    selectBatch, generate, deleteCreative, updateCreative, deleteBatch,
    renderImages, deleteImage, shareBatchForApproval, fanOutImage,
  };
}

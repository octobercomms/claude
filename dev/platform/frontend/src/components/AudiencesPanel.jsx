// Audience Insights panel — rendered inline inside the Paid suite
// (ClientAdsPage) when the Audiences tab is active. The parent owns
// the hero + SuiteTabs strip; this component renders only the body.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import Card from './ui/Card';
import Section from './ui/Section';
import Button from './ui/Button';
import Chip from './ui/Chip';
import EmptyState from './ui/EmptyState';

export default function AudiencesPanel({ clientId }) {
  const toast = useToast();
  const [distribution, setDistribution] = useState(null);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/audiences/clients/${clientId}/postcode-distribution`).catch(() => ({})),
      api.get(`/audiences/clients/${clientId}/segments`).catch(() => []),
    ]).then(([d, s]) => {
      setDistribution(d); setSegments(s || []); setLoading(false);
    });
  }, [clientId]);

  async function refreshDistribution() {
    setRefreshing(true);
    try {
      const d = await api.get(`/audiences/clients/${clientId}/postcode-distribution?refresh=1`);
      setDistribution(d);
      toast('Postcode distribution refreshed.', 'success');
    } catch (e) { toast(`Refresh failed: ${e.message}`, 'error'); }
    finally { setRefreshing(false); }
  }

  async function uploadCustomerList({ name, file }) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (name) fd.append('name', name);
      const seg = await api.postForm(`/audiences/clients/${clientId}/customer-lists`, fd);
      setSegments(prev => [seg, ...prev]);
      setShowUpload(false);
      toast(`Uploaded ${formatNum(seg.estimated_reach || 0)} contacts.`, 'success');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'error'); }
    finally { setUploading(false); }
  }

  async function saveSegment(payload) {
    try {
      const url = payload.id ? `/audiences/segments/${payload.id}` : `/audiences/clients/${clientId}/segments`;
      const method = payload.id ? 'put' : 'post';
      const seg = await api[method](url, payload);
      setSegments(prev => payload.id ? prev.map(s => s.id === seg.id ? seg : s) : [seg, ...prev]);
      setEditing(null);
      toast('Segment saved.', 'success');
    } catch (e) { toast(`Save failed: ${e.message}`, 'error'); }
  }

  async function deleteSegment(seg) {
    if (!confirm(`Delete segment "${seg.name}"?`)) return;
    try {
      await api.delete(`/audiences/segments/${seg.id}`);
      setSegments(prev => prev.filter(s => s.id !== seg.id));
    } catch (e) { toast(`Delete failed: ${e.message}`, 'error'); }
  }

  function exportSegment(seg) {
    fetch(`/api/audiences/segments/${seg.id}/export.csv`, {
      credentials: 'include',
    }).then(r => r.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${seg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-meta-audience.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  }

  if (loading) return null;

  const postcodes = distribution?.postcodes || [];
  const top10 = postcodes.slice(0, 10);
  const totalRevenue = Number(distribution?.total_revenue || 0);
  const totalOrders = Number(distribution?.total_orders || 0);
  const totalCustomers = postcodes.reduce((n, p) => n + p.customer_count, 0);
  const top10Revenue = top10.reduce((n, p) => n + p.revenue, 0);
  const concentration = totalRevenue > 0 ? Math.round((top10Revenue / totalRevenue) * 100) : 0;

  return (
    <>
      <p className="body mt-4 mb-6">
        Build targetable audiences from first-party data — postcode distribution from Shopify orders, or a customer list (email / phone) you upload yourself. Save named segments and export them as Meta Custom Audiences. Demographic overlay ships next.
      </p>

      <div className="metric-grid">
        <Metric label="Customers · 12m"      value={formatNum(totalCustomers)} />
        <Metric label="Orders · 12m"         value={formatNum(totalOrders)} />
        <Metric label="Revenue · 12m"        value={`£${formatNum(totalRevenue)}`} accent />
        <Metric label="Top-10 concentration" value={`${concentration}%`} />
      </div>

      {distribution?.note && (
        <Card variant="accent" className="mb-5">
          <div className="body">{distribution.note}</div>
        </Card>
      )}

      <Section
        caption="First-party data"
        title="Where your customers are"
        action={(
          <Button variant="secondary" onClick={refreshDistribution} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh from Shopify'}
          </Button>
        )}
      >
        {!top10.length ? (
          <EmptyState
            icon="📍"
            title="No first-party data yet"
            body="Connect Shopify and the system will walk every order to map postcode concentration."
          />
        ) : (
          <Card>
            <table className="table">
              <thead>
                <tr>
                  <th>Postcode</th>
                  <th className="num">Customers</th>
                  <th className="num">Orders</th>
                  <th className="num">Revenue</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {top10.map(p => {
                  const share = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
                  return (
                    <tr key={p.postcode_district}>
                      <td><Chip tone="accent">{p.postcode_district}</Chip></td>
                      <td className="num">{formatNum(p.customer_count)}</td>
                      <td className="num">{formatNum(p.order_count)}</td>
                      <td className="num strong">£{formatNum(p.revenue)}</td>
                      <td className="num">{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="body-xs text-subtle mt-3">
              Showing top 10 of {postcodes.length} postcodes by revenue.
              {' '}Computed {distribution?.computed_at ? new Date(distribution.computed_at).toLocaleString('en-GB') : 'never'}.
            </p>
          </Card>
        )}
      </Section>

      <Section
        caption="Saved audiences"
        title="Segments"
        action={(
          <div className="row wrap">
            <Button variant="secondary" onClick={() => setShowUpload(true)}>↑ Upload customer list</Button>
            <Button onClick={() => setEditing({ name: '', description: '', filters: {} })}>
              + New segment
            </Button>
          </div>
        )}
      >
        {!segments.length ? (
          <EmptyState
            icon="🎯"
            title="No segments yet"
            body="Define a named audience from postcode data (e.g. 'High-value SW postcodes'), or upload a customer list — then export it as a Meta Custom Audience CSV."
            action={{ label: 'Create first segment', onClick: () => setEditing({ name: '', description: '', filters: {} }) }}
          />
        ) : (
          <div className="grid grid-auto">
            {segments.map(s => (
              <Card key={s.id}>
                <div className="row between">
                  <h3 className="h3">{s.name}</h3>
                  <Chip>{s.source.replace('_', ' ')}</Chip>
                </div>
                {s.description && <p className="body-sm mt-3">{s.description}</p>}
                <p className="body-xs text-subtle mt-3">
                  Estimated reach: <span className="text-accent" style={{ fontWeight: 700 }}>{formatNum(s.estimated_reach || 0)} customers</span>
                </p>
                <div className="row mt-5 wrap">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>Edit</Button>
                  <Button variant="secondary" size="sm" onClick={() => exportSegment(s)}>↓ Meta CSV</Button>
                  <Button variant="danger" size="sm" onClick={() => deleteSegment(s)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {editing && (
        <SegmentEditor initial={editing} postcodes={postcodes} onClose={() => setEditing(null)} onSave={saveSegment} />
      )}

      {showUpload && (
        <CustomerListModal uploading={uploading} onClose={() => setShowUpload(false)} onUpload={uploadCustomerList} />
      )}
    </>
  );
}

function CustomerListModal({ uploading, onClose, onUpload }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);

  return (
    <div className="modal-backdrop">
      <div className="modal suite-paid">
        <div className="modal-head">
          <h2 className="h2">Upload customer list</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="body-sm mb-4">
          Upload a CSV with an <strong>email</strong> and/or <strong>phone</strong> column — a Shopify, Klaviyo or Mailchimp export works as-is.
          Contacts are hashed (SHA-256) on upload, so raw emails and phone numbers are never stored. The list becomes a segment you can
          export as a Meta Custom Audience.
        </p>
        <div className="field">
          <label className="field-label">List name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Newsletter subscribers (June)" autoFocus />
        </div>
        <div className="field">
          <label className="field-label">CSV file</label>
          <input className="input" type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} />
          {file && <p className="body-xs text-subtle mt-2">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
        </div>
        <div className="row end mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onUpload({ name: name.trim(), file })} disabled={!file || uploading}>
            {uploading ? 'Uploading…' : 'Upload & create segment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div className={`metric-card ${accent ? 'accent' : ''}`}>
      <div className="caption">{label}</div>
      <div className="metric mt-2">{value}</div>
    </div>
  );
}

function SegmentEditor({ initial, postcodes, onClose, onSave }) {
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [districts, setDistricts] = useState((initial.filters?.postcode_districts || []).join(', '));
  const [minRevenue, setMinRevenue] = useState(initial.filters?.min_revenue || '');
  const [minCustomers, setMinCustomers] = useState(initial.filters?.min_customers || '');

  function submit() {
    if (!name.trim()) return;
    const dList = districts.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    onSave({
      id: initial.id, name: name.trim(),
      description: description.trim() || null,
      filters: {
        postcode_districts: dList.length ? dList : undefined,
        min_revenue: minRevenue ? Number(minRevenue) : undefined,
        min_customers: minCustomers ? Number(minCustomers) : undefined,
      },
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal suite-paid">
        <div className="modal-head">
          <h2 className="h2">{initial.id ? 'Edit segment' : 'New segment'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="field">
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. High-value SW postcodes" autoFocus />
        </div>
        <div className="field">
          <label className="field-label">Description (optional)</label>
          <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Why this audience matters…" />
        </div>
        <div className="field">
          <label className="field-label">Postcode districts (comma- or space-separated)</label>
          <input className="input" value={districts} onChange={e => setDistricts(e.target.value)} placeholder="SW3, SW7, NW3, W11" />
          {postcodes.length > 0 && (
            <p className="body-xs text-subtle mt-2">
              Your top 8 by revenue: {postcodes.slice(0, 8).map(p => p.postcode_district).join(', ')}
            </p>
          )}
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label className="field-label">Min revenue per postcode (£)</label>
            <input className="input" type="number" min="0" value={minRevenue} onChange={e => setMinRevenue(e.target.value)} placeholder="0" />
          </div>
          <div className="field">
            <label className="field-label">Min customers per postcode</label>
            <input className="input" type="number" min="0" value={minCustomers} onChange={e => setMinCustomers(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="row end mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {initial.id ? 'Save changes' : 'Create segment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

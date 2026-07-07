// Audience Insights panel — rendered inline inside the Paid suite
// (ClientAdsPage) when the Audiences tab is active. The parent owns
// the hero + SuiteTabs strip; this component renders only the body.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';
import Card from './ui/Card';
import Section from './ui/Section';
import Button from './ui/Button';
import Chip from './ui/Chip';
import EmptyState from './ui/EmptyState';

export default function AudiencesPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [distribution, setDistribution] = useState(null);
  const [segments, setSegments] = useState([]);
  // The two fetches load independently: segments are quick, but the postcode
  // distribution walks up to a year of store orders on a cold cache and can
  // take several seconds. Gating the whole panel behind both left it blank —
  // so segments (incl. an uploaded list) render as soon as they arrive, and
  // the postcode section shows its own loading state.
  const [segLoading, setSegLoading] = useState(true);
  const [distLoading, setDistLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [gsDismissed, setGsDismissed] = useState(false);

  useEffect(() => {
    setSegLoading(true); setDistLoading(true);
    api.get(`/audiences/clients/${clientId}/segments`)
      .then(s => setSegments(s || [])).catch(() => setSegments([]))
      .finally(() => setSegLoading(false));
    api.get(`/audiences/clients/${clientId}/postcode-distribution`)
      .then(d => setDistribution(d || {})).catch(() => setDistribution({}))
      .finally(() => setDistLoading(false));
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

  const postcodes = distribution?.postcodes || [];
  const top10 = postcodes.slice(0, 10);
  const totalRevenue = Number(distribution?.total_revenue || 0);
  const totalOrders = Number(distribution?.total_orders || 0);
  const totalCustomers = postcodes.reduce((n, p) => n + p.customer_count, 0);
  const top10Revenue = top10.reduce((n, p) => n + p.revenue, 0);
  const concentration = totalRevenue > 0 ? Math.round((top10Revenue / totalRevenue) * 100) : 0;

  // A store is connected iff the backend didn't return the "no source" note.
  const sourceConnected = !distribution?.note;
  const sourceLabel = distribution?.source === 'woocommerce' ? 'WooCommerce'
    : distribution?.source === 'shopify' ? 'Shopify'
    : 'your store';
  const hasPostcodeData = top10.length > 0;

  return (
    <>
      <p className="body mt-4 mb-6">
        Build targetable audiences from first-party data — a customer list (email / phone) you upload yourself, plus postcode distribution pulled from your Shopify or WooCommerce orders. Save named segments and export them as Meta Custom Audiences. Demographic overlay ships next.
      </p>

      <MethodologyCard />

      {/* Segments come first: a customer-list lookalike is the highest-leverage
          audience (see methodology) and it works with no store connected — so
          a WooCommerce/list-only client sees their real data up top, not an
          empty Shopify map. */}
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
        {segLoading ? (
          <Card><div className="body-sm text-subtle">Loading segments…</div></Card>
        ) : !segments.length ? (
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

      {/* Postcode distribution — only meaningful with a connected store. When
          one is connected we show the map/metrics (or a "no orders yet" prompt);
          when none is, we show a compact connect card instead of an empty grid
          of zeros, so a list-only client isn't led by a section that can't fill. */}
      {distLoading ? (
        <Section caption="First-party data" title="Where your customers are">
          <Card><div className="body-sm text-subtle">Mapping your customers by postcode — walking the last 12 months of orders…</div></Card>
        </Section>
      ) : sourceConnected ? (
        <Section
          caption="First-party data"
          title="Where your customers are"
          action={(
            <Button variant="secondary" {...roWrite(readOnly, { onClick: refreshDistribution, disabled: refreshing })}>
              {refreshing ? 'Refreshing…' : `↻ Refresh from ${sourceLabel}`}
            </Button>
          )}
        >
          {!hasPostcodeData ? (
            <EmptyState
              icon="📍"
              title="No postcode data yet"
              body={`Connected to ${sourceLabel}, but no orders with postcodes came back for the last 12 months. Refresh once there are orders, and the system will map postcode concentration.`}
            />
          ) : (
            <>
              <div className="metric-grid mb-5">
                <Metric label="Customers · 12m"      value={formatNum(totalCustomers)} />
                <Metric label="Orders · 12m"         value={formatNum(totalOrders)} />
                <Metric label="Revenue · 12m"        value={`£${formatNum(totalRevenue)}`} accent />
                <Metric label="Top-10 concentration" value={`${concentration}%`} />
              </div>
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
            </>
          )}
        </Section>
      ) : (
        <Section caption="First-party data" title="Where your customers are">
          <Card variant="accent">
            <div className="row between center" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <p className="body-sm">
                  Connect a <strong>Shopify or WooCommerce</strong> store on the Setup → Connectors tab and OMI will
                  walk the last 12 months of orders to map where your customers are by postcode — useful for
                  layering geography onto competitor-adjacent and cold prospecting audiences.
                </p>
              </div>
              <Button variant="secondary" {...roWrite(readOnly, { onClick: refreshDistribution, disabled: refreshing })}>
                {refreshing ? 'Checking…' : '↻ Check for a store'}
              </Button>
            </div>
          </Card>
        </Section>
      )}

      {editing && (
        <SegmentEditor initial={editing} postcodes={postcodes} onClose={() => setEditing(null)} onSave={saveSegment} />
      )}

      {showUpload && (
        <CustomerListModal uploading={uploading} onClose={() => setShowUpload(false)} onUpload={uploadCustomerList} />
      )}

      {/* First-run: no first-party data and no saved segments. Dim the empty
          panel behind a modal that names the single best first action. */}
      {!segLoading && !distLoading && !top10.length && !segments.length && !showUpload && !editing && !gsDismissed && (
        <GetStartedModal
          hasStore={sourceConnected}
          onUpload={() => setShowUpload(true)}
          onConnectStore={refreshDistribution}
          onClose={() => setGsDismissed(true)}
          refreshing={refreshing}
        />
      )}
    </>
  );
}

// Shown when Audiences has nothing to work with yet. Points the AM straight at
// the highest-leverage first move — upload a buyer list — with connecting a
// store as the alternative. Uses the shared modal chrome so it dims the panel.
function GetStartedModal({ hasStore, onUpload, onConnectStore, onClose, refreshing }) {
  return (
    <div className="modal-backdrop">
      <div className="modal suite-paid" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 className="h2">Get started with Audiences</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Dismiss">×</button>
        </div>
        <p className="body-sm mb-4">
          There's no audience data here yet. The fastest way to a high-converting Meta audience is a
          <strong> value-based lookalike</strong> — and that starts from your own buyers.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <Card variant="accent">
            <div className="row between center" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <h3 className="h3">1 · Upload a customer list</h3>
                <p className="body-sm mt-1">A CSV of buyers (email / phone). Hashed on upload, exported as a Meta Custom Audience — seed your 1% lookalike from it. <strong>Best first move.</strong></p>
              </div>
              <Button onClick={onUpload}>↑ Upload list</Button>
            </div>
          </Card>
          <Card>
            <div className="row between center" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <h3 className="h3">2 · Or pull from your store</h3>
                <p className="body-sm mt-1">{hasStore
                  ? 'Map where your customers are by postcode from the last 12 months of orders.'
                  : 'Connect a Shopify or WooCommerce store on the Setup → Connectors tab, then refresh to map customers by postcode.'}</p>
              </div>
              <Button variant="secondary" onClick={onConnectStore} disabled={refreshing || !hasStore}>
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// House targeting methodology, surfaced so every audience built here follows
// the same priority order. Kept in sync with the backend `meta-audiences`
// playbook (docs/anothercountry-meta-targeting) that grounds the Strategist.
function MethodologyCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card variant="accent" className="mb-6">
      <button
        type="button"
        className="row between"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <div>
          <div className="caption">Methodology</div>
          <h3 className="h3 mt-1">How to build audiences that convert</h3>
        </div>
        <Chip tone="accent">{open ? 'Hide' : 'Show'}</Chip>
      </button>

      {open && (
        <div className="mt-4">
          <p className="body-sm">
            <strong>Signal first — nothing below works without it.</strong> Confirm the Meta pixel fires once per event
            (no GA4/GTM double-fire), the Conversions API is sending server-side purchase events, and purchase <em>value</em> is
            passed. Zero recorded conversions on real spend usually means broken tracking, not a dead channel — fix it before
            scaling budget or pausing on the strength of a zero.
          </p>

          <p className="body-sm mt-4">Build in this priority order:</p>
          <ol className="body-sm mt-2" style={{ paddingLeft: 18, display: 'grid', gap: 8 }}>
            <li>
              <strong>Value-based lookalike from real buyers</strong> — highest leverage. Upload the customer list below
              (emails + lifetime spend), seeding from only the <strong>top 20–25% by AOV</strong>. Quality of seed beats size:
              200–500 high-value buyers outperform 10,000 newsletter subscribers. Export → build a <strong>1% lookalike</strong>
              in Meta, validate it converts, then expand to 2–3%. Rebuild the seed every 30–60 days.
            </li>
            <li>
              <strong>Competitor-adjacent interest targeting</strong> — reach people already in-market. Where Meta won't index a
              smaller competitor brand as an interest, target adjacent publications instead and layer income / behaviour / the
              high-revenue postcodes shown above.
            </li>
            <li>
              <strong>Engagement retargeting</strong> — exhaust warm audiences before cold: profile visitors + post/reel engagers
              (90 days), product-page viewers who didn't checkout, 75%+ video viewers. Small but the highest-conversion pool.
            </li>
          </ol>

          <p className="body-xs text-subtle mt-4">
            Always exclude existing customers and recent converters from prospecting. Split roughly 60% lookalike / 30%
            competitor-adjacent / 10% retargeting once signal is clean; don't raise total spend until one audience type shows
            positive ROAS. The Strategist grounds its recommendations in this same methodology.
          </p>
        </div>
      )}
    </Card>
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

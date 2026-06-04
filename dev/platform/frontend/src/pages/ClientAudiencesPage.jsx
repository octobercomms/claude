// Audience Insights page for the Paid suite. Three sections:
//   1. Hero — Paid-suite yellow accent, headline metrics for first-party
//      reach + revenue concentration.
//   2. First-party postcode distribution — top revenue districts from
//      the client's Shopify orders, with a "Refresh" button that walks
//      every order in the last year.
//   3. Saved segments — AM-defined audiences with edit / delete /
//      Meta CSV export.
//
// Demographic overlay (income, age, household type) hooks land in a
// follow-up commit once the ONS data is bootstrapped.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Section from '../components/ui/Section';
import Button from '../components/ui/Button';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import { palette, space, type } from '../styles/tokens';

const ACCENT = palette.suite.paid;
const SOFT = palette.suiteSoft.paid;

export default function ClientAudiencesPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null);   // { id?, name, description, filters } | null

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/audiences/clients/${id}/postcode-distribution`).catch(() => ({})),
      api.get(`/audiences/clients/${id}/segments`).catch(() => []),
    ]).then(([c, d, s]) => {
      setClient(c); setDistribution(d); setSegments(s || []); setLoading(false);
    });
  }, [id]);

  async function refreshDistribution() {
    setRefreshing(true);
    try {
      const d = await api.get(`/audiences/clients/${id}/postcode-distribution?refresh=1`);
      setDistribution(d);
      toast('Postcode distribution refreshed.', 'success');
    } catch (e) {
      toast(`Refresh failed: ${e.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function saveSegment(payload) {
    try {
      const url = payload.id ? `/audiences/segments/${payload.id}` : `/audiences/clients/${id}/segments`;
      const method = payload.id ? 'put' : 'post';
      const seg = await api[method](url, payload);
      setSegments(prev => {
        const next = payload.id ? prev.map(s => s.id === seg.id ? seg : s) : [seg, ...prev];
        return next;
      });
      setEditing(null);
      toast('Segment saved.', 'success');
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    }
  }

  async function deleteSegment(seg) {
    if (!confirm(`Delete segment "${seg.name}"?`)) return;
    try {
      await api.delete(`/audiences/segments/${seg.id}`);
      setSegments(prev => prev.filter(s => s.id !== seg.id));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  function exportSegment(seg) {
    // Direct browser navigation gets the CSV downloaded.
    const token = localStorage.getItem('token');
    fetch(`/api/audiences/segments/${seg.id}/export.csv`, {
      headers: { Authorization: `Bearer ${token}` },
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
    <div>
      {/* HERO */}
      <div style={{ marginBottom: space[6] }}>
        <div style={{ ...type.caption, color: ACCENT }}>Audience Insights · Paid Suite</div>
        <div style={{ ...type.display, color: palette.text, marginTop: space[2] }}>
          {client?.name}
        </div>
        <div style={{ ...type.body, color: palette.textMuted, marginTop: space[2], maxWidth: 600 }}>
          Build targetable audiences from your first-party data. Today: postcode distribution from Shopify orders + named segments exportable as Meta Custom Audiences. Demographic overlay (income, age, household type) ships next.
        </div>
      </div>

      {/* METRIC ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space[3], marginBottom: space[5] }}>
        <HeroMetric label="Customers · 12m"     value={formatNum(totalCustomers)} />
        <HeroMetric label="Orders · 12m"        value={formatNum(totalOrders)} />
        <HeroMetric label="Revenue · 12m"       value={`£${formatNum(totalRevenue)}`} />
        <HeroMetric label="Top-10 concentration" value={`${concentration}%`} />
      </div>

      {distribution?.note && (
        <Card padding={space[4]} style={{ marginBottom: space[5], background: SOFT, border: `1px solid ${ACCENT}33` }}>
          <div style={{ ...type.body, color: palette.text }}>{distribution.note}</div>
        </Card>
      )}

      {/* POSTCODE DISTRIBUTION */}
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
            action={null}
            accent={ACCENT}
          />
        ) : (
          <Card padding={space[4]}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${palette.border}` }}>
                  <th style={th}>Postcode</th>
                  <th style={th}>Customers</th>
                  <th style={th}>Orders</th>
                  <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                  <th style={{ ...th, textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {top10.map(p => {
                  const share = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
                  return (
                    <tr key={p.postcode_district} style={{ borderBottom: `1px solid ${palette.border}` }}>
                      <td style={td}>
                        <Chip tone="accent" style={{ color: ACCENT, background: SOFT }}>{p.postcode_district}</Chip>
                      </td>
                      <td style={td}>{formatNum(p.customer_count)}</td>
                      <td style={td}>{formatNum(p.order_count)}</td>
                      <td style={{ ...td, textAlign: 'right', color: palette.text, fontWeight: 700 }}>£{formatNum(p.revenue)}</td>
                      <td style={{ ...td, textAlign: 'right', color: palette.textMuted }}>{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ ...type.bodyXs, color: palette.textSubtle, marginTop: space[3] }}>
              Showing top 10 of {postcodes.length} postcodes by revenue. Computed{' '}
              {distribution?.computed_at ? new Date(distribution.computed_at).toLocaleString('en-GB') : 'never'}.
            </div>
          </Card>
        )}
      </Section>

      {/* SAVED SEGMENTS */}
      <Section
        caption="Saved audiences"
        title="Segments"
        action={(
          <Button variant="primary" accent={ACCENT} onClick={() => setEditing({ name: '', description: '', filters: {} })}>
            + New segment
          </Button>
        )}
      >
        {!segments.length ? (
          <EmptyState
            icon="🎯"
            title="No segments yet"
            body="Define a named audience (e.g. 'High-value SW postcodes') and export it as a Meta Custom Audience CSV."
            action={{ label: 'Create first segment', onClick: () => setEditing({ name: '', description: '', filters: {} }) }}
            accent={ACCENT}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: space[3] }}>
            {segments.map(s => (
              <Card key={s.id} padding={space[4]}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3] }}>
                  <div style={{ ...type.h3, color: palette.text }}>{s.name}</div>
                  <Chip tone="neutral" style={{ textTransform: 'uppercase' }}>{s.source.replace('_', ' ')}</Chip>
                </div>
                {s.description && <div style={{ ...type.bodySm, color: palette.textMuted, marginTop: space[2] }}>{s.description}</div>}
                <div style={{ ...type.bodyXs, color: palette.textSubtle, marginTop: space[3] }}>
                  Estimated reach: <span style={{ color: ACCENT, fontWeight: 700 }}>{formatNum(s.estimated_reach || 0)} customers</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: space[4], flexWrap: 'wrap' }}>
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
        <SegmentEditor
          initial={editing}
          postcodes={postcodes}
          onClose={() => setEditing(null)}
          onSave={saveSegment}
        />
      )}
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
      id: initial.id,
      name: name.trim(),
      description: description.trim() || null,
      filters: {
        postcode_districts: dList.length ? dList : undefined,
        min_revenue: minRevenue ? Number(minRevenue) : undefined,
        min_customers: minCustomers ? Number(minCustomers) : undefined,
      },
    });
  }

  return (
    <div style={modalBackdrop}>
      <Card raised padding={space[6]} style={{ width: 560, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[5] }}>
          <div style={{ ...type.h2, color: palette.text }}>{initial.id ? 'Edit segment' : 'New segment'}</div>
          <button type="button" onClick={onClose} style={closeBtn}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
          <Field label="Name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. High-value SW postcodes" style={input} autoFocus />
          </Field>
          <Field label="Description (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Why this audience matters, who it's for…" style={{ ...input, minHeight: 64, resize: 'vertical' }} />
          </Field>
          <Field label="Postcode districts (comma- or space-separated)">
            <input type="text" value={districts} onChange={e => setDistricts(e.target.value)} placeholder="SW3, SW7, NW3, W11" style={input} />
            {postcodes.length > 0 && (
              <div style={{ ...type.bodyXs, color: palette.textSubtle, marginTop: 4 }}>
                Your top 8 by revenue: {postcodes.slice(0, 8).map(p => p.postcode_district).join(', ')}
              </div>
            )}
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] }}>
            <Field label="Min revenue per postcode (£)">
              <input type="number" min="0" value={minRevenue} onChange={e => setMinRevenue(e.target.value)} placeholder="0" style={input} />
            </Field>
            <Field label="Min customers per postcode">
              <input type="number" min="0" value={minCustomers} onChange={e => setMinCustomers(e.target.value)} placeholder="0" style={input} />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: space[6] }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" accent={ACCENT} onClick={submit} disabled={!name.trim()}>
            {initial.id ? 'Save changes' : 'Create segment'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ ...type.caption, color: palette.textSubtle, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function HeroMetric({ label, value }) {
  return (
    <Card padding={space[4]}>
      <div style={{ ...type.caption, color: palette.textSubtle }}>{label}</div>
      <div style={{ ...type.metric, color: palette.text, marginTop: space[2] }}>{value}</div>
    </Card>
  );
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: palette.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 };
const td = { padding: '10px 12px', fontSize: 13, color: palette.textMuted };
const input = { width: '100%', padding: '8px 10px', background: palette.surface, color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'inherit' };
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const closeBtn = { background: 'none', border: 'none', color: palette.textMuted, fontSize: 22, cursor: 'pointer' };

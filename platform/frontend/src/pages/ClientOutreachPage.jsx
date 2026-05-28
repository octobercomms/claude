import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import CampaignWizard from '../components/CampaignWizard';
import EditContactModal from '../components/EditContactModal';

// Claude-drafted email sequence for a campaign — generate and edit steps.
function CampaignSequence({ campaign, onCampaignChange }) {
  const toast = useToast();
  const [steps, setSteps] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    api.get(`/outreach/campaigns/${campaign.id}/sequences`)
      .then(setSteps)
      .catch(() => setSteps([]));
  }, [campaign.id]);

  async function generate() {
    setGenerating(true);
    try {
      const seq = await api.post(`/outreach/campaigns/${campaign.id}/generate`, {});
      setSteps(seq);
      toast('Email sequence drafted by Claude', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  function updateStep(stepId, field, value) {
    setSteps(prev => prev.map(st => (st.id === stepId ? { ...st, [field]: value } : st)));
  }

  async function saveStep(step) {
    try {
      await api.put(`/outreach/sequences/${step.id}`, {
        subject: step.subject, body: step.body, delay_days: step.delay_days,
      });
      toast('Step saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function launch() {
    if (!window.confirm('Launch this campaign? Emails will start sending to all of this client’s contacts.')) return;
    setBusy(true);
    try {
      const res = await api.post(`/outreach/campaigns/${campaign.id}/launch`, {});
      toast(`Campaign launched — ${res.enrolled} contact${res.enrolled === 1 ? '' : 's'} enrolled`, 'success');
      if (onCampaignChange) onCampaignChange();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  async function setCampaignState(action) {
    setBusy(true);
    try {
      await api.post(`/outreach/campaigns/${campaign.id}/${action}`, {});
      if (onCampaignChange) onCampaignChange();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  async function testSend() {
    if (!testTo.trim()) { toast('Enter a test recipient address', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/outreach/campaigns/${campaign.id}/test`, { to: testTo.trim() });
      toast(`Test email sent to ${testTo.trim()}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={generate} disabled={generating} style={s.btn}>
          {generating ? 'Drafting…' : (steps && steps.length ? '↻ Regenerate with Claude' : '✦ Generate sequence with Claude')}
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>3 emails — initial, follow-up, final nudge.</span>
      </div>
      {steps && steps.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {campaign.status === 'draft' && (
            <button onClick={launch} disabled={busy} style={s.btn}>{busy ? '…' : '▶ Launch campaign'}</button>
          )}
          {campaign.status === 'active' && (
            <button onClick={() => setCampaignState('pause')} disabled={busy} style={s.btnGhost}>{busy ? '…' : '⏸ Pause'}</button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={() => setCampaignState('resume')} disabled={busy} style={s.btn}>{busy ? '…' : '▶ Resume'}</button>
          )}
          <input style={{ ...s.input, width: 190 }} placeholder="test@you.com" value={testTo}
            onChange={e => setTestTo(e.target.value)} />
          <button onClick={testSend} disabled={busy} style={s.btnGhost}>Test send</button>
          <span style={{ fontSize: 12, color: '#888' }}>
            {campaign.contact_count || 0} enrolled · {campaign.sent_count || 0} sent · {campaign.opened_count || 0} opened
          </span>
        </div>
      )}
      {steps === null ? (
        <p style={{ fontSize: 12, color: '#aaa' }}>Loading…</p>
      ) : steps.length === 0 ? (
        <p style={{ fontSize: 12, color: '#888' }}>No sequence yet — generate one with Claude.</p>
      ) : (
        steps.map(step => (
          <div key={step.id} style={{ ...s.card, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Step {step.step_number} · sent day {step.delay_days}
            </div>
            <input style={{ ...s.input, width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
              value={step.subject || ''} placeholder="Subject"
              onChange={e => updateStep(step.id, 'subject', e.target.value)} />
            <textarea style={{ ...s.input, width: '100%', minHeight: 120, resize: 'vertical', boxSizing: 'border-box' }}
              value={step.body || ''} placeholder="Email body"
              onChange={e => updateStep(step.id, 'body', e.target.value)} />
            <button onClick={() => saveStep(step)} style={{ ...s.btn, marginTop: 8 }}>Save step</button>
          </div>
        ))
      )}
    </div>
  );
}

export default function ClientOutreachPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState(null);
  const [systemStatus, setSystemStatus] = useState([]);
  const [dnsCheck, setDnsCheck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', role: '', website: '' });
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', audience_description: '' });
  const [showFinder, setShowFinder] = useState(false);
  const [findDomain, setFindDomain] = useState('');
  const [finding, setFinding] = useState(false);
  const [foundContacts, setFoundContacts] = useState([]);
  const [findError, setFindError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [aud, setAud] = useState({ industry: '', location: '', specialisation: '' });
  const [searching, setSearching] = useState(false);
  const [serperDomains, setSerperDomains] = useState([]);
  const [serperError, setSerperError] = useState('');
  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [wizardCampaignId, setWizardCampaignId] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [selectedContacts, setSelectedContacts] = useState(() => new Set());
  const [contactFilter, setContactFilter] = useState({ search: '', contact_type: '', location: '' });
  const [sendCfg, setSendCfg] = useState({});
  const [savingSend, setSavingSend] = useState(false);
  const [sendSaved, setSendSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/outreach/contacts?client_id=${id}`),
      api.get(`/outreach/campaigns?client_id=${id}`),
      api.get(`/outreach/stats?client_id=${id}`).catch(() => null),
      api.get(`/outreach/system-status`).catch(() => []),
      api.get(`/outreach/dns-check`).catch(() => null),
    ])
      .then(([c, ct, cp, st, ss, dns]) => {
        setClient(c); setContacts(ct); setCampaigns(cp);
        setSendCfg(c.outreach_sending || {});
        setStats(st); setSystemStatus(ss || []);
        setDnsCheck(dns);
      })
      .catch(err => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  async function addContact(e) {
    e.preventDefault();
    try {
      const c = await api.post('/outreach/contacts', { ...newContact, client_id: id });
      setContacts(p => [c, ...p]);
      setNewContact({ name: '', email: '', company: '', role: '', website: '' });
      setShowAddContact(false);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteContact(cid) {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await api.delete(`/outreach/contacts/${cid}`);
      setContacts(p => p.filter(x => x.id !== cid));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function addCampaign(e) {
    e.preventDefault();
    try {
      const c = await api.post('/outreach/campaigns', { ...newCampaign, client_id: id });
      setCampaigns(p => [{ ...c, contact_count: 0 }, ...p]);
      setNewCampaign({ name: '', audience_description: '' });
      setShowAddCampaign(false);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function startNewCampaign() {
    try {
      const c = await api.post('/outreach/campaigns', {
        client_id: id,
        name: 'Untitled campaign',
        campaign_type: 'outreach',
      });
      setCampaigns(p => [{ ...c, contact_count: 0 }, ...p]);
      setTab('campaigns');
      setWizardCampaignId(c.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteCampaign(cid) {
    if (!window.confirm('Delete this campaign?')) return;
    try {
      await api.delete(`/outreach/campaigns/${cid}`);
      setCampaigns(p => p.filter(x => x.id !== cid));
    } catch (err) { toast(err.message, 'error'); }
  }

  function refreshCampaigns() {
    api.get(`/outreach/campaigns?client_id=${id}`).then(setCampaigns).catch(() => {});
  }

  async function saveSending() {
    setSavingSend(true); setSendSaved(false);
    try {
      await api.put(`/outreach/sending/${id}`, sendCfg);
      setSendSaved(true);
      setTimeout(() => setSendSaved(false), 3000);
    } catch (err) { toast(err.message, 'error'); }
    finally { setSavingSend(false); }
  }

  async function runFind(domainArg, source = 'hunter') {
    const domain = (typeof domainArg === 'string' ? domainArg : findDomain).trim();
    if (!domain) return;
    setFinding(true); setFindError(''); setFoundContacts([]); setSelected(new Set()); setSearched(false);
    try {
      const res = await api.post(`/outreach/find/${source}`, { domain });
      setFoundContacts(res.contacts || []);
      setSearched(true);
    } catch (err) {
      setFindError(err.message);
    } finally {
      setFinding(false);
    }
  }

  function toggleSelected(i) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function addFound() {
    const picked = foundContacts.filter((_, i) => selected.has(i));
    if (!picked.length) return;
    try {
      const { contacts: added } = await api.post('/outreach/contacts/bulk', { client_id: id, contacts: picked });
      setContacts(p => [...added, ...p]);
      setFoundContacts([]); setSelected(new Set()); setSearched(false); setShowFinder(false);
      toast(`Added ${added.length} contact${added.length === 1 ? '' : 's'}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function runSerper() {
    setSearching(true); setSerperError(''); setSerperDomains([]);
    try {
      const res = await api.post('/outreach/find/serper', aud);
      setSerperDomains(res.domains || []);
    } catch (err) {
      setSerperError(err.message);
    } finally {
      setSearching(false);
    }
  }

  // ── Contacts table — filtering, bulk select, CSV import/export ───────────
  const filteredContacts = useMemo(() => {
    const q = contactFilter.search.toLowerCase().trim();
    const loc = contactFilter.location.toLowerCase().trim();
    const typ = contactFilter.contact_type.trim();
    return contacts.filter(c => {
      if (q) {
        const hay = [c.name, c.first_name, c.last_name, c.email, c.company].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (loc && !(c.location || '').toLowerCase().includes(loc)) return false;
      if (typ && c.contact_type !== typ) return false;
      return true;
    });
  }, [contacts, contactFilter]);

  const allSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContacts.has(c.id));
  function toggleContactSelected(cid) {
    setSelectedContacts(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  }
  function toggleSelectAll() {
    if (allSelected) setSelectedContacts(new Set());
    else setSelectedContacts(new Set(filteredContacts.map(c => c.id)));
  }
  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selectedContacts.size} selected contact${selectedContacts.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const ids = [...selectedContacts];
    try {
      await api.post('/outreach/contacts/bulk-delete', { client_id: id, ids });
      setContacts(p => p.filter(c => !selectedContacts.has(c.id)));
      setSelectedContacts(new Set());
      toast(`Deleted ${ids.length} contact${ids.length === 1 ? '' : 's'}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  function handleCsvExport() {
    const headers = ['first_name', 'last_name', 'email', 'company', 'contact_type', 'title', 'location', 'linkedin_url', 'source', 'status', 'notes'];
    const csv = [
      headers.join(','),
      ...contacts.map(c => headers.map(h => csvEscape(c[h] || c[h === 'title' ? 'role' : ''] || '')).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `contacts-${(client?.name || 'client').replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  async function handleCsvImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) { toast('No usable rows found in CSV (every row needs an email).', 'error'); return; }
      const res = await api.post('/outreach/contacts/bulk', { client_id: id, contacts: parsed });
      setContacts(p => [...res.contacts, ...p]);
      toast(`Imported ${res.inserted} of ${parsed.length} contact${parsed.length === 1 ? '' : 's'}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  function onContactUpdated(updated) {
    setContacts(p => p.map(c => c.id === updated.id ? updated : c));
  }

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  const recentCampaigns = campaigns.slice(0, 5);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Outreach — {client?.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setTab('contacts'); setShowAddContact(true); }} style={s.btnGhost}>+ Add Contact</button>
          <button onClick={startNewCampaign} style={s.btn}>+ New Campaign</button>
        </div>
      </div>

      {/* Tabs — same underline pattern as the SEO and Ads pages */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginBottom: 24 }}>
        {[
          ['dashboard', 'Dashboard'],
          ['campaigns', campaigns.length ? `Campaigns (${campaigns.length})` : 'Campaigns'],
          ['contacts', contacts.length ? `Contacts (${contacts.length})` : 'Contacts'],
          ['press', 'Press'],
          ['sending', 'Sending'],
          ['help', 'Help'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14,
            fontWeight: tab === key ? 700 : 400, color: tab === key ? '#1a1a1a' : '#888',
            borderBottom: tab === key ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div>
          {/* Stats cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              ['Active Contacts', stats?.active_contacts],
              ['Active Campaigns', stats?.active_campaigns],
              ['Emails Sent', stats?.emails_sent],
              ['Replies', stats?.replies],
            ].map(([label, value]) => (
              <div key={label} style={s.card}>
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{value ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* System Status + Recent Campaigns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 16 }}>
            <div style={s.card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>System Status</div>
              {systemStatus.length === 0 ? (
                <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Loading…</p>
              ) : <>
                {systemStatus.map(item => (
                  <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                    <span>{item.name}</span>
                    <span style={{ color: item.status === 'connected' ? '#2e7d32' : '#c62828', fontWeight: 600, fontSize: 12 }}>
                      {item.status === 'connected' ? '✓ Connected' : '✗ Not configured'}
                    </span>
                  </div>
                ))}
                {dnsCheck && dnsCheck.domain && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span>SPF record <code style={{ fontSize: 11, color: '#888' }}>{dnsCheck.domain}</code></span>
                      <span style={{ color: dnsCheck.spf === 'found' ? '#2e7d32' : '#e65100', fontWeight: 600, fontSize: 12 }}>
                        {dnsCheck.spf === 'found' ? '✓ Found' : '⚠ Missing'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span>DMARC record</span>
                      <span style={{ color: dnsCheck.dmarc === 'found' ? '#2e7d32' : '#e65100', fontWeight: 600, fontSize: 12 }}>
                        {dnsCheck.dmarc === 'found' ? '✓ Found' : '⚠ Missing'}
                      </span>
                    </div>
                  </>
                )}
              </>}
              <p style={{ fontSize: 11, color: '#aaa', margin: '10px 0 0' }}>Configure missing integrations in platform Settings. SPF / DMARC use the Outreach Sending Domain.</p>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Campaigns</div>
                {campaigns.length > 5 && <button onClick={() => setTab('campaigns')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#666', padding: 0 }}>View all →</button>}
              </div>
              {recentCampaigns.length === 0 ? (
                <p style={{ fontSize: 12, color: '#888', margin: 0 }}>No campaigns yet — use “+ New Campaign” above to create one.</p>
              ) : (
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <tbody>
                    {recentCampaigns.map(c => (
                      <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setTab('campaigns')}>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>{c.name}</td>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5' }}><span style={s.chip}>{c.status}</span></td>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5', textAlign: 'right', color: '#888', fontSize: 12 }}>
                          {new Date(c.created_at).toLocaleDateString('en-GB')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'contacts' && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAddContact(v => !v)} style={s.btn}>{showAddContact ? 'Cancel' : '+ Add contact'}</button>
            <button onClick={() => setShowFinder(v => !v)} style={s.btnGhost}>{showFinder ? 'Close finder' : '⌕ Find contacts'}</button>
          </div>
          {showFinder && (
            <div style={{ ...s.card, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Find companies by audience (Serper)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 8 }}>
                <input style={s.input} placeholder="Industry" value={aud.industry}
                  onChange={e => setAud(p => ({ ...p, industry: e.target.value }))} />
                <input style={s.input} placeholder="Location" value={aud.location}
                  onChange={e => setAud(p => ({ ...p, location: e.target.value }))} />
                <input style={s.input} placeholder="Specialisation" value={aud.specialisation}
                  onChange={e => setAud(p => ({ ...p, specialisation: e.target.value }))} />
                <button onClick={runSerper} disabled={searching} style={s.btn}>{searching ? 'Searching…' : 'Search'}</button>
              </div>
              {serperError && <p style={{ color: '#c62828', fontSize: 12, margin: '8px 0 0' }}>{serperError}</p>}
              {serperDomains.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {serperDomains.map(d => (
                    <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: '1px solid #f0f0f0' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.domain}</div>
                        {d.title && <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>}
                      </div>
                      <button onClick={() => { setFindDomain(d.domain); runFind(d.domain); }} style={s.btnGhost}>Find emails →</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: '1px solid #eee', margin: '14px 0 8px', paddingTop: 14, fontWeight: 600, fontSize: 13 }}>Or find emails for a known domain</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...s.input, flex: 1 }} placeholder="Company domain — e.g. example.com"
                  value={findDomain} onChange={e => setFindDomain(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runFind(findDomain, 'hunter'); }} />
                <button onClick={() => runFind(findDomain, 'hunter')} disabled={finding} style={s.btn}>{finding ? '…' : 'Hunter'}</button>
                <button onClick={() => runFind(findDomain, 'icypeas')} disabled={finding} style={s.btnGhost}>{finding ? '…' : 'Icypeas'}</button>
              </div>
              {findError && <p style={{ color: '#c62828', fontSize: 12, margin: '8px 0 0' }}>{findError}</p>}
              {searched && foundContacts.length === 0 && !findError && (
                <p style={{ color: '#888', fontSize: 12, margin: '8px 0 0' }}>No emails found for that domain.</p>
              )}
              {foundContacts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <table style={s.table}>
                    <thead><tr>{['', 'Name', 'Email', 'Role', 'Confidence'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {foundContacts.map((c, i) => (
                        <tr key={i}>
                          <td style={s.td}><input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelected(i)} /></td>
                          <td style={s.td}>{c.name || '—'}</td>
                          <td style={s.td}>{c.email}</td>
                          <td style={s.td}>{c.role || '—'}</td>
                          <td style={s.td}>{c.confidence != null ? `${c.confidence}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={addFound} disabled={selected.size === 0} style={{ ...s.btn, marginTop: 10 }}>
                    Add {selected.size} selected
                  </button>
                </div>
              )}
            </div>
          )}
          {showAddContact && (
            <form onSubmit={addContact} style={{ ...s.card, marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {['name', 'email', 'company', 'role', 'website'].map(f => (
                <input key={f} style={s.input} placeholder={f[0].toUpperCase() + f.slice(1)} value={newContact[f]}
                  required={f === 'email'}
                  onChange={e => setNewContact(p => ({ ...p, [f]: e.target.value }))} />
              ))}
              <button type="submit" style={{ ...s.btn, gridColumn: '1 / -1', justifySelf: 'start' }}>Add contact</button>
            </form>
          )}

          {/* Secondary toolbar: CSV import/export + bulk actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ ...s.btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', margin: 0 }}>
              ↑ Import CSV
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvImport} />
            </label>
            <button onClick={handleCsvExport} disabled={contacts.length === 0} style={s.btnGhost}>↓ Export CSV</button>
            {selectedContacts.size > 0 && (
              <button onClick={handleBulkDelete} style={{ ...s.btnGhost, color: '#c62828', borderColor: '#e3b1b1' }}>Delete {selectedContacts.size} selected</button>
            )}
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
              CSV columns — required: <code>email</code>. Optional: <code>first_name</code>, <code>last_name</code>, <code>company</code>, <code>contact_type</code>, <code>title</code>, <code>location</code>, <code>linkedin_url</code>, <code>notes</code>.
            </span>
          </div>

          {/* Filters row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10, marginTop: 12 }}>
            <input style={s.input} placeholder="Search name / email / company" value={contactFilter.search}
              onChange={e => setContactFilter(f => ({ ...f, search: e.target.value }))} />
            <input style={s.input} list="contact-types-filter" placeholder="Filter by type"
              value={contactFilter.contact_type} onChange={e => setContactFilter(f => ({ ...f, contact_type: e.target.value }))} />
            <datalist id="contact-types-filter">
              {['architect', 'interior_designer', 'journalist', 'editor', 'developer', 'retailer', 'distributor', 'agency'].map(t => <option key={t} value={t} />)}
            </datalist>
            <input style={s.input} placeholder="Filter by location" value={contactFilter.location}
              onChange={e => setContactFilter(f => ({ ...f, location: e.target.value }))} />
          </div>

          {/* Contacts table */}
          <div style={{ ...s.tableWrap, marginTop: 12 }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 32 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  </th>
                  {['Name', 'Email', 'Company', 'Type', 'Location', 'Status', 'Added', ''].map(h => <th key={h} style={s.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>
                    {contacts.length === 0 ? 'No contacts yet — add manually, find new, or import a CSV.' : 'No contacts match these filters.'}
                  </td></tr>
                ) : filteredContacts.map(c => (
                  <tr key={c.id}>
                    <td style={s.td}><input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleContactSelected(c.id)} /></td>
                    <td style={s.td}>{c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td style={s.td}>{c.email || '—'}</td>
                    <td style={s.td}>{c.company || '—'}</td>
                    <td style={s.td}>{c.contact_type || '—'}</td>
                    <td style={s.td}>{c.location || '—'}</td>
                    <td style={s.td}><span style={s.chip}>{c.status}</span></td>
                    <td style={s.td}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '—'}</td>
                    <td style={s.td}>
                      <button onClick={() => setEditingContact(c)} style={{ ...s.btnGhost, padding: '4px 10px', fontSize: 12 }}>Edit</button>
                      <button onClick={() => deleteContact(c.id)} title="Delete" style={s.del}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
            Showing {filteredContacts.length} of {contacts.length} contact{contacts.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {tab === 'press' && <PressPanel clientId={id} contacts={contacts} />}

      {tab === 'help' && <HelpPanel dnsCheck={dnsCheck} />}

      {editingContact && (
        <EditContactModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={onContactUpdated}
        />
      )}

      {tab === 'campaigns' && wizardCampaignId && (
        <CampaignWizard
          clientId={id}
          campaignId={wizardCampaignId}
          onExit={() => { setWizardCampaignId(null); refreshCampaigns(); }}
          onCampaignChange={refreshCampaigns}
        />
      )}

      {tab === 'campaigns' && !wizardCampaignId && (
        <div>
          <button onClick={startNewCampaign} style={s.btn}>+ New campaign</button>
          <div style={{ ...s.tableWrap, marginTop: 12 }}>
            <table style={s.table}>
              <thead><tr>{['Campaign', 'Brand', 'Type', 'Status', 'Contacts', 'Sent / Total', 'Created', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No campaigns yet — click “+ New campaign” to start the wizard.</td></tr>
                ) : campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.audience_description && <div style={{ fontSize: 11, color: '#999' }}>{c.audience_description.slice(0, 80)}{c.audience_description.length > 80 ? '…' : ''}</div>}
                    </td>
                    <td style={s.td}>{c.brand || '—'}</td>
                    <td style={s.td}>{c.campaign_type === 'press_release' ? 'Press' : 'Outreach'}</td>
                    <td style={s.td}><span style={s.chip}>{c.status}</span></td>
                    <td style={s.td}>{c.contact_count || 0}</td>
                    <td style={s.td}>{(c.sent_count || 0)} / {(c.contact_count || 0)}</td>
                    <td style={s.td}>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                    <td style={s.td}>
                      <button onClick={() => setWizardCampaignId(c.id)} style={{ ...s.btnGhost, padding: '4px 10px', fontSize: 12 }}>Open wizard</button>
                      <button onClick={() => deleteCampaign(c.id)} title="Delete" style={s.del}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sending' && (
        <div style={{ ...s.card, maxWidth: 520 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Outreach sending</div>
          <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
            How outreach emails for this client are sent. Leave a field blank to use the platform default. Set From to your own address and Reply-To to wherever replies should land.
          </p>
          {[['from_name', 'From name'], ['from_email', 'From email'], ['reply_to', 'Reply-To email']].map(([k, label]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>{label}</label>
              <input style={{ ...s.input, width: '100%', boxSizing: 'border-box' }} value={sendCfg[k] || ''}
                onChange={e => setSendCfg(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
          <button onClick={saveSending} disabled={savingSend} style={s.btn}>{savingSend ? 'Saving…' : 'Save sending settings'}</button>
          {sendSaved && <span style={{ marginLeft: 10, color: '#2e7d32', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
        </div>
      )}
    </div>
  );
}

// Help & Support panel — static setup guides for the integrations Outreach uses.
function HelpPanel({ dnsCheck }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <HelpCard title="Claude AI">
        <p>Powers audience refinement, email writing and reply classification.</p>
        <p><strong>What you need:</strong> a paid Anthropic API key from <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>.</p>
        <ol>
          <li>Create an account and add credit.</li>
          <li>Create an API key.</li>
          <li>Paste it into Settings → AI &amp; Email → Claude AI.</li>
        </ol>
      </HelpCard>

      <HelpCard title="Hunter.io">
        <p>Finds published email addresses by company domain. Free plan: 50 searches/month.</p>
        <ol>
          <li>Sign up at <a href="https://hunter.io" target="_blank" rel="noreferrer">hunter.io</a>.</li>
          <li>Open your API key under Dashboard → API.</li>
          <li>Paste it into Settings → Outreach → October Outreach.</li>
        </ol>
      </HelpCard>

      <HelpCard title="Icypeas">
        <p>Lead database with PAYG credits that never expire. Use as the primary finder alongside Hunter.</p>
        <ol>
          <li>Sign up at <a href="https://icypeas.com" target="_blank" rel="noreferrer">icypeas.com</a> and top up credits.</li>
          <li>Go to Settings → API in your Icypeas account.</li>
          <li>Copy the <strong>API Key</strong>, <strong>API Secret</strong> and <strong>User ID</strong> — all three are required.</li>
          <li>Paste all three into Settings → Outreach → October Outreach.</li>
        </ol>
      </HelpCard>

      <HelpCard title="Email Sending — Amazon SES">
        <p>Recommended for outreach because of low cost (~$0.10 / 1,000 emails) and good deliverability.</p>
        <ol>
          <li>Verify your sending domain in the SES console.</li>
          <li>Move out of sandbox mode (request production access) so you can send to any address.</li>
          <li>Create an IAM user with <code>ses:SendEmail</code> permission and grab its <strong>Access Key ID</strong> + <strong>Secret Access Key</strong>.</li>
          <li>Save them in Settings → AI &amp; Email → Amazon SES. The platform uses the SESv2 API automatically when these are set.</li>
        </ol>
      </HelpCard>

      <HelpCard title="SPF, DKIM &amp; DMARC">
        <p>Three DNS records that decide whether your emails land in the inbox or junk.</p>
        <ul>
          <li><strong>SPF</strong> — TXT record on your sending domain authorising the sender. For SES: <code>v=spf1 include:amazonses.com -all</code></li>
          <li><strong>DKIM</strong> — set up in the SES console (Verified identities → Configuration → DKIM). Three CNAME records.</li>
          <li><strong>DMARC</strong> — TXT record on <code>_dmarc.yourdomain.com</code>. A safe starter: <code>v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com</code></li>
        </ul>
        {dnsCheck && dnsCheck.domain && (
          <p style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
            Current check for <code>{dnsCheck.domain}</code>:{' '}
            <span style={{ color: dnsCheck.spf === 'found' ? '#2e7d32' : '#e65100', fontWeight: 600 }}>SPF {dnsCheck.spf === 'found' ? '✓' : '⚠'}</span>{' · '}
            <span style={{ color: dnsCheck.dmarc === 'found' ? '#2e7d32' : '#e65100', fontWeight: 600 }}>DMARC {dnsCheck.dmarc === 'found' ? '✓' : '⚠'}</span>
          </p>
        )}
      </HelpCard>

      <HelpCard title="Reply Polling (IMAP)">
        <p>The platform polls your reply inbox over IMAP. When a reply arrives, Claude classifies it as <em>interested / not_now / not_relevant / unsubscribe / auto_reply / question</em>, follow-ups to that contact are cancelled, and unsubscribes flip the contact's status.</p>
        <ol>
          <li>Use a dedicated reply inbox (e.g. <code>replies@yourbrand.com</code>).</li>
          <li>If using Gmail, enable IMAP and create an <strong>App Password</strong> (Google Account → Security → 2-Step Verification → App passwords).</li>
          <li>Add the host (<code>imap.gmail.com</code>), port (<code>993</code>), user and password to Settings → Outreach → Outreach Reply Inbox.</li>
        </ol>
      </HelpCard>
    </div>
  );
}
function HelpCard({ title, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 18, fontSize: 13, lineHeight: 1.55, color: '#333' }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>{title}</h3>
      {children}
    </div>
  );
}

// Escape a single value for CSV — double-quote and escape inner quotes if the
// value contains anything CSV-sensitive.
function csvEscape(v) {
  const s = String(v ?? '');
  if (/["\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Simple CSV parser. Handles quoted fields with embedded commas / newlines /
// escaped quotes. Maps a flexible set of header aliases to our canonical
// contact fields per the product brief.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const ALIASES = {
    first: 'first_name', firstname: 'first_name', first_name: 'first_name',
    last: 'last_name', lastname: 'last_name', last_name: 'last_name',
    full_name: 'name', name: 'name',
    email_address: 'email', email: 'email', e_mail: 'email',
    company_name: 'company', practice: 'company', company: 'company', organisation: 'company', organization: 'company',
    type: 'contact_type', contact_type: 'contact_type',
    role: 'title', position: 'title', job_title: 'title', title: 'title',
    city: 'location', location: 'location', address: 'location',
    linkedin: 'linkedin_url', linkedin_url: 'linkedin_url',
    notes: 'notes', note: 'notes',
    source: 'source',
  };
  const headers = rows[0].map(h => {
    const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ALIASES[k] || k;
  });
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.length || cells.every(c => !c.trim())) continue;
    const o = {};
    headers.forEach((h, i) => {
      const val = (cells[i] || '').trim();
      if (val) o[h] = val;
    });
    if (!o.email) continue;
    out.push(o);
  }
  return out;
}

const s = {
  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 },
  btn: { padding: '9px 22px', fontSize: 13, fontWeight: 700, background: '#E7CD41', color: '#1a1a1a', border: 'none', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnGhost: { padding: '9px 22px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap' },
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' },
  tableWrap: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '11px 16px', borderBottom: '1px solid #f5f5f5', fontSize: 13, verticalAlign: 'middle' },
  chip: { fontSize: 11, background: '#eee', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' },
  del: { background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1, padding: '0 4px' },
};

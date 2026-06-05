import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import SuiteOverview from '../components/SuiteOverview';
import MailboxesPanel from '../components/MailboxesPanel';
import { useToast } from '../context/ToastContext';
import CampaignWizard from '../components/CampaignWizard';
import EditContactModal from '../components/EditContactModal';
import PressCampaignWizard from '../components/PressCampaignWizard';
import PressCampaignDetail from '../components/PressCampaignDetail';
import ImportWizard from '../components/ImportWizard';
import { csvEscape } from '../utils/csv';

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
        <button onClick={generate} disabled={generating} className="btn btn-primary">
          {generating ? 'Drafting…' : (steps && steps.length ? '↻ Regenerate with Claude' : '✦ Generate sequence with Claude')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>3 emails — initial, follow-up, final nudge.</span>
      </div>
      {steps && steps.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {campaign.status === 'draft' && (
            <button onClick={launch} disabled={busy} className="btn btn-primary">{busy ? '…' : '▶ Launch campaign'}</button>
          )}
          {campaign.status === 'active' && (
            <button onClick={() => setCampaignState('pause')} disabled={busy} className="btn btn-secondary">{busy ? '…' : '⏸ Pause'}</button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={() => setCampaignState('resume')} disabled={busy} className="btn btn-primary">{busy ? '…' : '▶ Resume'}</button>
          )}
          <input className="input" style={{ width: 190 }} placeholder="test@you.com" value={testTo}
            onChange={e => setTestTo(e.target.value)} />
          <button onClick={testSend} disabled={busy} className="btn btn-secondary">Test send</button>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {campaign.contact_count || 0} enrolled · {campaign.sent_count || 0} sent · {campaign.opened_count || 0} opened
          </span>
        </div>
      )}
      {steps === null ? (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</p>
      ) : steps.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No sequence yet — generate one with Claude.</p>
      ) : (
        steps.map(step => (
          <div key={step.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Step {step.step_number} · sent day {step.delay_days}
            </div>
            <input className="input" style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
              value={step.subject || ''} placeholder="Subject"
              onChange={e => updateStep(step.id, 'subject', e.target.value)} />
            <textarea className="input" style={{ width: '100%', minHeight: 120, resize: 'vertical', boxSizing: 'border-box' }}
              value={step.body || ''} placeholder="Email body"
              onChange={e => updateStep(step.id, 'body', e.target.value)} />
            <button onClick={() => saveStep(step)} className="btn btn-primary" style={{ marginTop: 8 }}>Save step</button>
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
  const [tab, setTab] = useState('overview');
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState(null);
  const [systemStatus, setSystemStatus] = useState([]);
  const [dnsCheck, setDnsCheck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', role: '', website: '' });
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [showPressWizard, setShowPressWizard] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', audience_description: '' });
  const [showFinder, setShowFinder] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
    if (!window.confirm('Remove this contact from this client? The contact stays in the workspace library and is unaffected for any other client they’re attached to.')) return;
    try {
      await api.delete(`/outreach/clients/${id}/contacts/${cid}`);
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

  async function duplicateCampaign(c) {
    // Clones the campaign as a draft with the same sequence + audience.
    // Recipients, sends and cached AI emails are intentionally NOT
    // copied — the AM picks fresh contacts and Claude regenerates per-
    // recipient pitches so edits to the duplicate take effect.
    try {
      const dup = await api.post(`/outreach/campaigns/${c.id}/duplicate`, {});
      setCampaigns(p => [{ ...dup, contact_count: 0 }, ...p]);
      setWizardCampaignId(dup.id);
      toast(`Duplicated as "${dup.name}"`, 'success');
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


  function onContactUpdated(updated) {
    setContacts(p => p.map(c => c.id === updated.id ? updated : c));
  }

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  const recentCampaigns = campaigns.slice(0, 5);

  return (
    <div className="suite-email">
      <header className="hero">
        <div>
          <div className="client-name">{client?.name}</div>
          <h1 className="display mt-2"><span className="text-accent">Email</span></h1>
        </div>
        <div className="hero-actions">
          <button onClick={() => { setTab('contacts'); setShowAddContact(true); }} className="btn btn-secondary btn-sm">+ Add Contact</button>
          <button onClick={startNewCampaign} className="btn btn-primary btn-sm">+ New Campaign</button>
        </div>
      </header>

      <SuiteTabs tabs={[
        { key: 'overview',  label: 'Overview',                                                   active: tab === 'overview',  onClick: () => setTab('overview') },
        { key: 'dashboard', label: 'Dashboard',                                                  active: tab === 'dashboard', onClick: () => setTab('dashboard') },
        { key: 'campaigns', label: 'Campaigns', badge: campaigns.length || undefined,            active: tab === 'campaigns', onClick: () => setTab('campaigns') },
        { key: 'contacts',  label: 'Contacts',  badge: contacts.length || undefined,             active: tab === 'contacts',  onClick: () => setTab('contacts') },
        { key: 'sending',   label: 'Sending',                                                    active: tab === 'sending',   onClick: () => setTab('sending') },
        { key: 'help',      label: 'Help',                                                       active: tab === 'help',      onClick: () => setTab('help') },
      ]} />

      {tab === 'overview' && (
        <SuiteOverview
          tagline="Native cold outreach — built for agencies."
          description="Find contacts, draft sequences with Claude, send from your own domain, and track every reply. Press releases ship from the same flow."
          ctaLabel="Open the dashboard"
          onCta={() => setTab('dashboard')}
          flow={[
            { label: 'Find',     detail: 'Hunter + Serper + library' },
            { label: 'Draft',    detail: 'Claude writes the sequence' },
            { label: 'Send',     detail: 'From your domain, tracked' },
            { label: 'Classify', detail: 'Replies + bounces routed' },
          ]}
          capabilities={[
            { tag: 'Find',       title: 'Contact discovery',          body: 'Hunter.io domain search, Serper-backed audience discovery, CSV import, or pull from the workspace contact library.' },
            { tag: 'Draft',      title: 'Claude writes the sequence', body: 'Three steps — initial, follow-up, final nudge — personalised per recipient from the contact + brand brief.' },
            { tag: 'Deliver',    title: 'Your domain, honestly',      body: 'SPF / DKIM / DMARC checker keeps deliverability on rails. Open + click tracking via signed URLs. One-click unsubscribe.' },
            { tag: 'Reply loop', title: 'Auto-classified replies',    body: 'Bounces, OOO, interested, not-interested — all routed to the right column without manual triage.' },
            { tag: 'Press',      title: 'Press releases too',         body: 'Sibling flow for journalist outreach: same finder, same sequence engine, different copy template.' },
            { tag: 'Tags',       title: 'Workspace-wide library',     body: 'Contacts are shared across clients — tag once, reuse everywhere. Per-client unsubscribe state respected.' },
          ]}
        />
      )}

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
              <div key={label} className="card">
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{value ?? '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* System Status + Recent Campaigns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 16 }}>
            <div className="card">
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>System Status</div>
              {systemStatus.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>Loading…</p>
              ) : <>
                {systemStatus.map(item => (
                  <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                    <span>{item.name}</span>
                    <span style={{ color: item.status === 'connected' ? 'var(--positive)' : 'var(--negative)', fontWeight: 600, fontSize: 12 }}>
                      {item.status === 'connected' ? '✓ Connected' : '✗ Not configured'}
                    </span>
                  </div>
                ))}
                {dnsCheck && dnsCheck.domain && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span>SPF record <code style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{dnsCheck.domain}</code></span>
                      <span style={{ color: dnsCheck.spf === 'found' ? 'var(--positive)' : 'var(--warning)', fontWeight: 600, fontSize: 12 }}>
                        {dnsCheck.spf === 'found' ? '✓ Found' : '⚠ Missing'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f5f5f5', fontSize: 13 }}>
                      <span>DMARC record</span>
                      <span style={{ color: dnsCheck.dmarc === 'found' ? 'var(--positive)' : 'var(--warning)', fontWeight: 600, fontSize: 12 }}>
                        {dnsCheck.dmarc === 'found' ? '✓ Found' : '⚠ Missing'}
                      </span>
                    </div>
                  </>
                )}
              </>}
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '10px 0 0' }}>Configure missing integrations in platform Settings. SPF / DMARC use the Outreach Sending Domain.</p>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Campaigns</div>
                {campaigns.length > 5 && <button onClick={() => setTab('campaigns')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: 0 }}>View all →</button>}
              </div>
              {recentCampaigns.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>No campaigns yet — use “+ New Campaign” above to create one.</p>
              ) : (
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <tbody>
                    {recentCampaigns.map(c => (
                      <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setTab('campaigns')}>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>{c.name}</td>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5' }}><span className="chip chip-neutral">{c.status}</span></td>
                        <td style={{ padding: '8px 0', borderTop: '1px solid #f5f5f5', textAlign: 'right', color: 'var(--text-subtle)', fontSize: 12 }}>
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
            <button onClick={() => setShowAddContact(v => !v)} className="btn btn-primary">{showAddContact ? 'Cancel' : '+ Add contact'}</button>
            <button onClick={() => setShowLibrary(v => !v)} className="btn btn-secondary">{showLibrary ? 'Close library' : '+ Add from library'}</button>
            <button onClick={() => setShowFinder(v => !v)} className="btn btn-secondary">{showFinder ? 'Close finder' : '⌕ Find contacts'}</button>
          </div>
          {showLibrary && (
            <LibraryPicker clientId={id} onAttached={async () => {
              setShowLibrary(false);
              try {
                const fresh = await api.get(`/outreach/contacts?client_id=${id}`);
                setContacts(fresh);
              } catch (err) { toast(err.message, 'error'); }
            }} />
          )}
          {showFinder && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Find companies by audience (Serper)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 8 }}>
                <input className="input" placeholder="Industry" value={aud.industry}
                  onChange={e => setAud(p => ({ ...p, industry: e.target.value }))} />
                <input className="input" placeholder="Location" value={aud.location}
                  onChange={e => setAud(p => ({ ...p, location: e.target.value }))} />
                <input className="input" placeholder="Specialisation" value={aud.specialisation}
                  onChange={e => setAud(p => ({ ...p, specialisation: e.target.value }))} />
                <button onClick={runSerper} disabled={searching} className="btn btn-primary">{searching ? 'Searching…' : 'Search'}</button>
              </div>
              {serperError && <p style={{ color: 'var(--negative)', fontSize: 12, margin: '8px 0 0' }}>{serperError}</p>}
              {serperDomains.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {serperDomains.map(d => (
                    <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: '1px solid #f0f0f0' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.domain}</div>
                        {d.title && <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>}
                      </div>
                      <button onClick={() => { setFindDomain(d.domain); runFind(d.domain); }} className="btn btn-secondary">Find emails →</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: '1px solid #eee', margin: '14px 0 8px', paddingTop: 14, fontWeight: 600, fontSize: 13 }}>Or find emails for a known domain</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder="Company domain — e.g. example.com"
                  value={findDomain} onChange={e => setFindDomain(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runFind(findDomain, 'hunter'); }} />
                <button onClick={() => runFind(findDomain, 'hunter')} disabled={finding} className="btn btn-primary">{finding ? '…' : 'Hunter'}</button>
                <button onClick={() => runFind(findDomain, 'icypeas')} disabled={finding} className="btn btn-secondary">{finding ? '…' : 'Icypeas'}</button>
              </div>
              {findError && <p style={{ color: 'var(--negative)', fontSize: 12, margin: '8px 0 0' }}>{findError}</p>}
              {searched && foundContacts.length === 0 && !findError && (
                <p style={{ color: 'var(--text-subtle)', fontSize: 12, margin: '8px 0 0' }}>No emails found for that domain.</p>
              )}
              {foundContacts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead><tr>{['', 'Name', 'Email', 'Role', 'Confidence'].map(h => <th key={h} >{h}</th>)}</tr></thead>
                    <tbody>
                      {foundContacts.map((c, i) => (
                        <tr key={i}>
                          <td ><input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelected(i)} /></td>
                          <td >{c.name || '—'}</td>
                          <td >{c.email}</td>
                          <td >{c.role || '—'}</td>
                          <td >{c.confidence != null ? `${c.confidence}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={addFound} disabled={selected.size === 0} className="btn btn-primary" style={{ marginTop: 10 }}>
                    Add {selected.size} selected
                  </button>
                </div>
              )}
            </div>
          )}
          {showAddContact && (
            <form onSubmit={addContact} className="card" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {['name', 'email', 'company', 'role', 'website'].map(f => (
                <input key={f} className="input" placeholder={f[0].toUpperCase() + f.slice(1)} value={newContact[f]}
                  required={f === 'email'}
                  onChange={e => setNewContact(p => ({ ...p, [f]: e.target.value }))} />
              ))}
              <button type="submit" className="btn btn-primary" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>Add contact</button>
            </form>
          )}

          {/* Secondary toolbar: CSV import/export + bulk actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowImport(true)} className="btn btn-secondary">↑ Import CSV</button>
            <button onClick={handleCsvExport} disabled={contacts.length === 0} className="btn btn-secondary">↓ Export CSV</button>
            {selectedContacts.size > 0 && (
              <button onClick={handleBulkDelete} className="btn btn-secondary" style={{ color: 'var(--negative)', borderColor: 'var(--negative)' }}>Delete {selectedContacts.size} selected</button>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 'auto' }}>
              CSV columns — required: <code>email</code>. Optional: <code>first_name</code>, <code>last_name</code>, <code>company</code>, <code>contact_type</code>, <code>title</code>, <code>location</code>, <code>linkedin_url</code>, <code>notes</code>.
            </span>
          </div>

          {/* Filters row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10, marginTop: 12 }}>
            <input className="input" placeholder="Search name / email / company" value={contactFilter.search}
              onChange={e => setContactFilter(f => ({ ...f, search: e.target.value }))} />
            <input className="input" list="contact-types-filter" placeholder="Filter by type"
              value={contactFilter.contact_type} onChange={e => setContactFilter(f => ({ ...f, contact_type: e.target.value }))} />
            <datalist id="contact-types-filter">
              {['architect', 'interior_designer', 'journalist', 'editor', 'developer', 'retailer', 'distributor', 'agency'].map(t => <option key={t} value={t} />)}
            </datalist>
            <input className="input" placeholder="Filter by location" value={contactFilter.location}
              onChange={e => setContactFilter(f => ({ ...f, location: e.target.value }))} />
          </div>

          {/* Contacts table */}
          <div className="card" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  </th>
                  {['Name', 'Email', 'Company', 'Type', 'Location', 'Status', 'Added', ''].map(h => <th key={h} >{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>
                    {contacts.length === 0 ? 'No contacts yet — add manually, find new, or import a CSV.' : 'No contacts match these filters.'}
                  </td></tr>
                ) : filteredContacts.map(c => (
                  <tr key={c.id}>
                    <td ><input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleContactSelected(c.id)} /></td>
                    <td >{c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>
                      {c.email || '—'}
                      <VerifyBadge contact={c} onVerified={(updated) => setContacts(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x))} />
                    </td>
                    <td >{c.company || '—'}</td>
                    <td >{c.contact_type || '—'}</td>
                    <td >{c.location || '—'}</td>
                    <td ><span className="chip chip-neutral">{c.status}</span></td>
                    <td >{c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '—'}</td>
                    <td >
                      <button onClick={() => setEditingContact(c)} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>Edit</button>
                      <button onClick={() => deleteContact(c.id)} title="Delete" className="text-negative" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>
            Showing {filteredContacts.length} of {contacts.length} contact{contacts.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {tab === 'help' && <HelpPanel dnsCheck={dnsCheck} />}

      {editingContact && (
        <EditContactModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={onContactUpdated}
        />
      )}

      <ImportWizard
        open={showImport}
        onClose={() => setShowImport(false)}
        clientIdForAttach={id}
        onImported={async () => {
          try {
            const fresh = await api.get(`/outreach/contacts?client_id=${id}`);
            setContacts(fresh);
          } catch (err) { toast(err.message, 'error'); }
        }}
      />


      {tab === 'campaigns' && wizardCampaignId && (() => {
        const c = campaigns.find(x => x.id === wizardCampaignId);
        // Only the new `kind` column triggers the press view. The legacy
        // `campaign_type` field was used in older flows and many of those
        // campaigns never had an actual press_release row created — so
        // honouring it here used to send the AM into a permanent
        // "Loading release..." state.
        if (c?.kind === 'press_release') {
          return (
            <PressCampaignDetail
              clientId={id} campaignId={wizardCampaignId} contacts={contacts}
              onExit={() => { setWizardCampaignId(null); refreshCampaigns(); }}
            />
          );
        }
        return (
          <CampaignWizard
            clientId={id} campaignId={wizardCampaignId}
            onExit={() => { setWizardCampaignId(null); refreshCampaigns(); }}
            onCampaignChange={refreshCampaigns}
          />
        );
      })()}

      {tab === 'campaigns' && showPressWizard && (
        <PressCampaignWizard
          clientId={id}
          onClose={() => setShowPressWizard(false)}
          onCreated={(release) => {
            setShowPressWizard(false);
            refreshCampaigns();
            if (release?.campaign_id) setWizardCampaignId(release.campaign_id);
          }}
        />
      )}

      {tab === 'campaigns' && !wizardCampaignId && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startNewCampaign} className="btn btn-primary">+ New campaign</button>
            <button onClick={() => setShowPressWizard(true)} className="btn btn-secondary">+ New press release</button>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr>{['Campaign', 'Brand', 'Type', 'Status', 'Contacts', 'Sent / Total', 'Created', ''].map(h => <th key={h} >{h}</th>)}</tr></thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>No campaigns yet — click “+ New campaign” to start the wizard.</td></tr>
                ) : campaigns.map(c => (
                  <tr key={c.id}>
                    <td >
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.audience_description && <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.audience_description.slice(0, 80)}{c.audience_description.length > 80 ? '…' : ''}</div>}
                    </td>
                    <td >{c.brand || '—'}</td>
                    <td >{(c.kind === 'press_release' || c.campaign_type === 'press_release') ? <span className="chip chip-neutral" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid #f0d260' }}>Press</span> : 'Outreach'}</td>
                    <td ><span className="chip chip-neutral">{c.status}</span></td>
                    <td >{c.contact_count || 0}</td>
                    <td >{(c.sent_count || 0)} / {(c.contact_count || 0)}</td>
                    <td >{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                    <td >
                      <button onClick={() => setWizardCampaignId(c.id)} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>Open wizard</button>
                      <button onClick={() => duplicateCampaign(c)} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }}
                        title="Make a draft copy of this campaign with the same sequence + audience">
                        Duplicate
                      </button>
                      <button onClick={() => deleteCampaign(c.id)} title="Delete" className="text-negative" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sending' && (
        <div className="stack stack-lg">
          <MailboxesPanel clientId={id} />

          <div className="card" style={{ maxWidth: 520 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Legacy single-sender fallback</div>
          <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '0 0 14px' }}>
            Used only when no mailboxes are configured above. Leave blank to use the platform default. Set From to your own address and Reply-To to wherever replies should land.
          </p>
          {[['from_name', 'From name'], ['from_email', 'From email'], ['reply_to', 'Reply-To email']].map(([k, label]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
              <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={sendCfg[k] || ''}
                onChange={e => setSendCfg(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
          <button onClick={saveSending} disabled={savingSend} className="btn btn-primary">{savingSend ? 'Saving…' : 'Save sending settings'}</button>
          {sendSaved && <span style={{ marginLeft: 10, color: 'var(--positive)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
          </div>
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
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Current check for <code>{dnsCheck.domain}</code>:{' '}
            <span style={{ color: dnsCheck.spf === 'found' ? 'var(--positive)' : 'var(--warning)', fontWeight: 600 }}>SPF {dnsCheck.spf === 'found' ? '✓' : '⚠'}</span>{' · '}
            <span style={{ color: dnsCheck.dmarc === 'found' ? 'var(--positive)' : 'var(--warning)', fontWeight: 600 }}>DMARC {dnsCheck.dmarc === 'found' ? '✓' : '⚠'}</span>
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
    <div style={{ background: 'var(--accent-soft)', border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)', padding: 18, fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>{title}</h3>
      {children}
    </div>
  );
}

// Escape a single value for CSV — double-quote and escape inner quotes if the
// value contains anything CSV-sensitive.
// Page-local style shorthand. All values now flow from the global
// design tokens (--accent, --border-w, etc) so this page picks up the
// suite-email accent automatically and matches every other page's
// border / radius / padding.

// Picker that lists workspace contacts not already attached to this client,
// filterable by tag, with multi-select + attach.
function LibraryPicker({ clientId, onAttached }) {
  const [rows, setRows] = useState(null);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get(`/outreach/contacts/library?not_attached_to=${clientId}`),
      api.get('/outreach/tags'),
    ]).then(([rs, ts]) => { setRows(rs); setTags(ts); })
      .catch(e => setErr(e.message));
  }, [clientId]);

  function toggleTag(t) {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }
  function toggleRow(idV) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idV)) next.delete(idV); else next.add(idV);
      return next;
    });
  }

  const filtered = rows ? rows.filter(r => {
    if (activeTags.size) {
      const have = new Set(r.tags || []);
      for (const t of activeTags) if (!have.has(t)) return false;
    }
    if (!search) return true;
    const sLower = search.toLowerCase();
    return (r.name || '').toLowerCase().includes(sLower)
        || (r.email || '').toLowerCase().includes(sLower)
        || (r.company || '').toLowerCase().includes(sLower);
  }) : null;

  async function attach() {
    if (!selected.size) return;
    setBusy(true);
    try {
      await api.post(`/outreach/clients/${clientId}/contacts/attach`, { contact_ids: Array.from(selected) });
      onAttached();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Add from library</div>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
        Pick contacts from the workspace library to attach to this client. They keep existing for
        every other client they’re already on — adding here doesn’t remove them from anywhere.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or outlet…" className="input" style={{ flex: '1 1 200px' }} />
      </div>
      {!!tags.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {tags.slice(0, 20).map(t => (
            <button key={t.tag} onClick={() => toggleTag(t.tag)}
              style={{
                padding: '3px 9px', borderRadius: 'var(--r-pill)', fontSize: 11,
                border: '1px solid ' + (activeTags.has(t.tag) ? 'var(--text)' : 'var(--accent-soft)'),
                background: activeTags.has(t.tag) ? 'var(--text)' : 'var(--surface)',
                color: activeTags.has(t.tag) ? 'var(--surface)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>
              {t.tag} <span style={{ opacity: 0.6 }}>· {t.count}</span>
            </button>
          ))}
        </div>
      )}

      {err && <div style={{ padding: 8, background: 'var(--negative-soft)', color: 'var(--negative)', fontSize: 12, borderRadius: 'var(--r-sm)' }}>{err}</div>}
      {!filtered && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}
      {filtered && !filtered.length && (
        <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
          No contacts in the library aren't already attached. Add some via Settings → Contacts library.
        </div>
      )}

      {filtered && !!filtered.length && (
        <>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)' }}>
            {filtered.map(r => (
              <label key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderTop: '1px solid #f4f4f4', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name || '(unnamed)'} {r.company && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· {r.company}</span>}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{r.email}</div>
                </div>
                {(r.tags || []).slice(0, 4).map(t => (
                  <span key={t} style={{ fontSize: 10, background: 'var(--accent-soft)', borderRadius: 'var(--r-sm)', padding: '1px 6px', color: 'var(--text-muted)' }}>{t}</span>
                ))}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} selected</div>
            <button onClick={attach} disabled={!selected.size || busy} className="btn btn-primary">
              {busy ? 'Attaching…' : `Add ${selected.size || ''} to this client`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Verification badge — shows the cached status next to the contact's
// email, and a "verify now" link when nothing's been done yet.
// Hitting POST /contacts/:id/verify writes the latest status back to
// the row so the badge updates without a refresh.
function VerifyBadge({ contact, onVerified }) {
  const [busy, setBusy] = React.useState(false);
  async function check() {
    setBusy(true);
    try {
      const r = await api.post(`/outreach/contacts/${contact.id}/verify`, {});
      onVerified && onVerified({
        verification_status: r.status,
        verification_score: r.score,
        last_verified_at: new Date().toISOString(),
      });
    } catch {} finally { setBusy(false); }
  }
  const s = contact.verification_status;
  if (!s || s === 'pending') {
    return <button className="btn-ghost" style={{ fontSize: 10, marginLeft: 6, padding: '0 4px' }} onClick={check} disabled={busy}>{busy ? '…' : 'verify'}</button>;
  }
  const tone = s === 'valid' ? 'success' : s === 'invalid' ? 'danger' : s === 'risky' ? 'warning' : 'neutral';
  return <span className={`chip chip-${tone}`} style={{ marginLeft: 6, fontSize: 10 }}>{s}</span>;
}

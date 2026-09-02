import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import ProcessRail from '../components/ProcessRail';
import SuiteOverview from '../components/SuiteOverview';
import MailboxesPanel from '../components/MailboxesPanel';
import OutreachTasksPanel from '../components/OutreachTasksPanel';
import { useToast } from '../context/ToastContext';
import CampaignWizard from '../components/CampaignWizard';
import EditContactModal from '../components/EditContactModal';
import NewCampaignModal from '../components/NewCampaignModal';
import ImportWizard from '../components/ImportWizard';
import SequenceBuilder from '../components/SequenceBuilder';
import SelectiveOutreachPanel from '../components/SelectiveOutreachPanel';
import { csvEscape } from '../utils/csv';
import { useTabParam } from '../hooks/useTabParam';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

// Colour a lead's fit score: strong (green) / moderate (amber) / weak (red).
function fitColor(n) {
  if (n == null) return 'var(--text-subtle)';
  if (n >= 70) return 'var(--positive, #1a7f37)';
  if (n >= 45) return '#9a6b00';
  return 'var(--negative, #b3261e)';
}

// Claude-drafted email sequence for a campaign — generate and edit steps.
function CampaignSequence({ campaign, onCampaignChange }) {
  const toast = useToast();
  const { readOnly } = useAuth();
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
    if (!window.confirm('Launch this campaign? Emails will start sending to all of this client’s leads.')) return;
    setBusy(true);
    try {
      const res = await api.post(`/outreach/campaigns/${campaign.id}/launch`, {});
      toast(`Campaign launched — ${res.enrolled} lead${res.enrolled === 1 ? '' : 's'} enrolled`, 'success');
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
        <button {...roWrite(readOnly, { onClick: generate, disabled: generating })} className="btn btn-primary">
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
          <button {...roWrite(readOnly, { onClick: testSend, disabled: busy })} className="btn btn-secondary">Test send</button>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {campaign.contact_count || 0} enrolled · {campaign.sent_count || 0} sent · {campaign.opened_count || 0} opened
          </span>
        </div>
      )}
      <SequenceBuilder campaignId={campaign.id} clientId={campaign.client_id} />
    </div>
  );
}

export default function ClientOutreachPage({ embedded = false, clientId: clientIdProp } = {}) {
  const { id: routeId } = useParams();
  const id = clientIdProp || routeId;
  const toast = useToast();
  const { readOnly } = useAuth();
  const [client, setClient] = useState(null);
  // When embedded (inside Owned → Email), use a separate ?etab= key so we don't
  // fight the host page over ?tab=.
  const [tab, setTab] = useTabParam(embedded ? 'campaigns' : 'overview', ['overview', 'campaigns', 'contacts', 'tasks', 'sending', 'prospecting'], embedded ? 'etab' : 'tab');
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState(null);
  const [systemStatus, setSystemStatus] = useState([]);
  const [dnsCheck, setDnsCheck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', role: '', website: '' });
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', audience_description: '' });
  const [showFinder, setShowFinder] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [findDomain, setFindDomain] = useState('');
  const [scrapeUrlInput, setScrapeUrlInput] = useState('');
  const [finding, setFinding] = useState(false);
  const [foundContacts, setFoundContacts] = useState([]);
  const [findError, setFindError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [aud, setAud] = useState({ industry: '', location: '', specialisation: '' });
  const [searching, setSearching] = useState(false);
  const [serperDomains, setSerperDomains] = useState([]);
  const [serperError, setSerperError] = useState('');
  const [scrapeRun, setScrapeRun] = useState(null);
  const [icpScraping, setIcpScraping] = useState(false);
  const [rankCriteria, setRankCriteria] = useState('');
  const [ranking, setRanking] = useState(false);
  const [deepProviders, setDeepProviders] = useState([]);
  const [deepProvider, setDeepProvider] = useState('');
  const [deepTitles, setDeepTitles] = useState('');
  const [deepLoading, setDeepLoading] = useState(false);
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
      api.get(`/outreach/contacts?client_id=${id}&kind=prospect,industry`),
      api.get(`/outreach/campaigns?client_id=${id}`),
      api.get(`/outreach/stats?client_id=${id}`).catch(() => null),
      api.get(`/outreach/system-status`).catch(() => []),
      api.get(`/outreach/dns-check`).catch(() => null),
    ])
      .then(([c, ct, cp, st, ss, dns]) => {
        setClient(c); setContacts(ct); setCampaigns(cp);
        // Seed the lead-ranking criteria from the client's brief so "Rank by
        // fit" works out of the box; the AM can refine it per search.
        setRankCriteria(prev => prev || c.briefing_field || c.monthly_focus || '');
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
    if (!window.confirm('Remove this lead from this client? The lead stays in the workspace library and is unaffected for any other client they’re attached to.')) return;
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

  // Free scrape source — reads a public page and pulls contacts off it. Feeds
  // the same foundContacts preview + addFound() path as Hunter/Icypeas.
  async function runScrape(urlArg, crawl = false) {
    const url = (typeof urlArg === 'string' ? urlArg : scrapeUrlInput).trim();
    if (!url) return;
    setFinding(true); setFindError(''); setFoundContacts([]); setSelected(new Set()); setSearched(false);
    try {
      const res = await api.post('/outreach/find/scrape', { url, crawl });
      setFoundContacts(res.contacts || []);
      // Pre-select everything that has an email — the usual keep set.
      setSelected(new Set((res.contacts || []).map((c, i) => (c.email ? i : null)).filter(i => i !== null)));
      setSearched(true);
    } catch (err) {
      setFindError(err.message);
    } finally {
      setFinding(false);
    }
  }

  // Async ICP scrape — Serper finds sites, the scraper crawls each, contacts
  // accumulate into a run we poll. When done they land in the same preview.
  async function runIcpScrape() {
    setIcpScraping(true); setFindError(''); setFoundContacts([]); setSelected(new Set()); setSearched(false); setScrapeRun(null);
    try {
      const { run } = await api.post('/outreach/find/scrape/icp', { client_id: id, ...aud });
      setScrapeRun(run);
      pollScrapeRun(run.id);
    } catch (err) { setFindError(err.message); setIcpScraping(false); }
  }

  async function pollScrapeRun(runId) {
    try {
      const { run } = await api.get(`/outreach/find/scrape/runs/${runId}?client_id=${id}`);
      setScrapeRun(run);
      if (run.status === 'running') { setTimeout(() => pollScrapeRun(runId), 4000); return; }
      setFoundContacts(run.results || []);
      setSelected(new Set((run.results || []).map((c, i) => (c.email ? i : null)).filter(i => i !== null)));
      setSearched(true);
      setIcpScraping(false);
    } catch (err) { setFindError(err.message); setIcpScraping(false); }
  }

  function toggleSelected(i) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  // Which paid providers are configured (Apollo / PDL / Hunter) — only offer
  // the ones with an API key set.
  useEffect(() => {
    api.get('/outreach/find/deep/providers').then(r => {
      const ps = r.providers || [];
      setDeepProviders(ps);
      setDeepProvider(prev => prev || ps[0] || '');
    }).catch(() => {});
  }, []);

  const PROVIDER_LABEL = { apollo: 'Apollo', peopledatalabs: 'People Data Labs', hunter: 'Hunter Discover' };

  // Deep find — paid provider discovery. Results flow into the same
  // foundContacts preview as the free finders (select → rank → add).
  async function runDeepFind() {
    if (!deepProvider) { toast('No paid provider configured — add a key in Settings → Integrations.', 'error'); return; }
    setDeepLoading(true); setFindError(''); setFoundContacts([]); setSelected(new Set()); setSearched(false);
    try {
      const res = await api.post('/outreach/find/deep', {
        client_id: id, provider: deepProvider,
        query: { titles: deepTitles, industry: aud.industry, location: aud.location, keywords: aud.specialisation },
      });
      const found = res.contacts || [];
      setFoundContacts(found); setSearched(true);
      setSelected(new Set(found.map((c, i) => (c.email ? i : null)).filter(i => i !== null)));
      if (!found.length) setFindError('No leads returned — broaden the criteria or try another provider.');
    } catch (e) { setFindError(e.message); }
    finally { setDeepLoading(false); }
  }

  // Score the current find/scrape results by fit against the AM's criteria and
  // re-order best-first. Auto-selects the strong fits (score ≥ 60 with an email)
  // so the AM can add the good ones in one click.
  async function runRank() {
    if (!foundContacts.length) return;
    if (!rankCriteria.trim()) { toast('Add some criteria to rank by.', 'error'); return; }
    setRanking(true);
    try {
      const res = await api.post('/outreach/score', { client_id: id, criteria: rankCriteria, contacts: foundContacts });
      const ranked = res.contacts || [];
      setFoundContacts(ranked);
      setSelected(new Set(ranked.map((c, i) => (c.email && c.fit_score != null && c.fit_score >= 60 ? i : null)).filter(i => i !== null)));
    } catch (e) { toast(e.message, 'error'); }
    finally { setRanking(false); }
  }

  async function addFound() {
    const picked = foundContacts.filter((_, i) => selected.has(i));
    if (!picked.length) return;
    try {
      const { contacts: added } = await api.post('/outreach/contacts/bulk', { client_id: id, contacts: picked });
      setContacts(p => [...added, ...p]);
      setFoundContacts([]); setSelected(new Set()); setSearched(false); setShowFinder(false);
      toast(`Added ${added.length} lead${added.length === 1 ? '' : 's'}`, 'success');
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
    if (!window.confirm(`Delete ${selectedContacts.size} selected lead${selectedContacts.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const ids = [...selectedContacts];
    try {
      await api.post('/outreach/contacts/bulk-delete', { client_id: id, ids });
      setContacts(p => p.filter(c => !selectedContacts.has(c.id)));
      setSelectedContacts(new Set());
      toast(`Deleted ${ids.length} lead${ids.length === 1 ? '' : 's'}`, 'success');
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

  // Owned → Email is business outreach only. Press campaigns live in
  // Earned → Pitch — filter any out of the list, counts and rail here so
  // they never surface in this suite.
  const outreachCampaigns = campaigns.filter(c => c.kind !== 'press_release' && c.campaign_type !== 'press_release');
  const recentCampaigns = outreachCampaigns.slice(0, 5);

  return (
    <div className="suite-email">
      {!embedded && <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Email outreach · sequences &amp; mailboxes</span></div>}
      {!embedded && (
        <header className="hero">
          <div>
            <h1 className="display mt-2">Email</h1>
          </div>
        </header>
      )}

      {embedded ? (
        // Embedded in Owned → Email: a stepped Build → Run rail (verbs), to
        // match every other suite group. ✓ derives from real state.
        <div className="stepper-block">
          <ProcessRail numbered wrap grouped activeKey={tab} onStep={setTab} steps={[
            { groupLabel: 'Your list' },
            { key: 'contacts',  title: 'Find',  sub: 'Your lead list',           status: contacts.length ? 'done' : 'todo' },
            { key: 'campaigns', title: 'Write', sub: 'The email sequence',        status: outreachCampaigns.length ? 'done' : 'todo' },
            { key: 'sending',   title: 'Send',  sub: 'From your domain, tracked', status: (stats?.emails_sent || 0) > 0 ? 'done' : 'todo' },
            { key: 'tasks',     title: 'Chase', sub: 'Replies & follow-ups',      status: 'todo' },
            { groupLabel: 'AI-sourced' },
            { key: 'prospecting', title: 'Selective', sub: 'AI finds them, you approve each', status: 'todo' },
          ]} />
        </div>
      ) : (
        <SuiteTabs tabs={[
          { key: 'overview', label: 'Overview', active: tab === 'overview', onClick: () => setTab('overview') },
          { key: 'campaigns', label: 'Campaigns', badge: campaigns.length || undefined, active: tab === 'campaigns', onClick: () => setTab('campaigns') },
          { key: 'contacts',  label: 'Leads',  badge: contacts.length || undefined,  active: tab === 'contacts',  onClick: () => setTab('contacts') },
          { key: 'tasks',     label: 'Tasks',                                           active: tab === 'tasks',     onClick: () => setTab('tasks') },
          { key: 'sending',   label: 'Sending',                                         active: tab === 'sending',   onClick: () => setTab('sending') },
          { key: 'prospecting', label: 'Selective outreach',                            active: tab === 'prospecting', onClick: () => setTab('prospecting') },
        ]} />
      )}

      {tab === 'prospecting' && (
        <SelectiveOutreachPanel clientId={id} />
      )}

      {tab === 'tasks' && (
        <OutreachTasksPanel />
      )}

      {!embedded && tab === 'overview' && (
        <div className="stack stack-lg">
        <SuiteOverview
          tagline="Win new clients from your own domain."
          description="Two ways to prospect: run cold outreach from your own lead list, or let AI source and fit-score prospects for you to approve one by one. Claude drafts every sequence; replies classify themselves."
          ctaLabel="Browse campaigns"
          onCta={() => setTab('campaigns')}
          status={[
            { label: 'Leads', value: `${contacts.length}`, ok: contacts.length > 0 },
            { label: 'Campaigns', value: `${outreachCampaigns.length}`, ok: outreachCampaigns.length > 0 },
            { label: 'Emails sent', value: `${stats?.emails_sent ?? 0}`, ok: (stats?.emails_sent || 0) > 0 },
          ]}
          flow={[
            { label: 'Find',     detail: 'Hunter + Serper + library' },
            { label: 'Draft',    detail: 'Claude writes the sequence' },
            { label: 'Send',     detail: 'From your domain, tracked' },
            { label: 'Classify', detail: 'Replies + bounces routed' },
          ]}
          capabilities={[
            { tag: 'Leads',      title: 'Find the right people',       cta: 'Open leads', onClick: () => setTab('contacts'), body: 'Hunter + Serper discovery, CSV import, or pull from the shared workspace library — tagged and deduped.' },
            { tag: 'Campaigns',  title: 'Claude drafts the sequence',  cta: 'Open campaigns', onClick: () => setTab('campaigns'), body: 'Initial, follow-up and final nudge — personalised per recipient from the contact + brand brief, then launched and tracked.' },
            { tag: 'Tasks',      title: 'Work the multichannel steps', cta: 'Open tasks', onClick: () => setTab('tasks'), body: 'LinkedIn and manual steps land in a daily queue; tick one off and the prospect advances automatically.' },
            { tag: 'Sending',    title: 'Land in the inbox',           cta: 'Open sending', onClick: () => setTab('sending'), body: 'Rotate multiple sender mailboxes with warm-up and daily caps; SPF / DKIM / DMARC kept on rails, replies auto-classified.' },
            { tag: 'Selective',  title: 'Let AI source the prospects', cta: 'Open selective', onClick: () => setTab('prospecting'), body: 'AI researches and fit-scores prospects and drafts each message — you approve every prospect and every send. Runs from a separate sending identity.' },
          ]}
        />

        <div>
          {/* Stats cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              ['Active Leads', stats?.active_contacts],
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
        </div>
      )}

      {tab === 'contacts' && (
        <div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button onClick={() => setShowAddContact(v => !v)} className="btn btn-primary">{showAddContact ? 'Cancel' : '+ Add lead'}</button>
            <button onClick={() => setShowFinder(v => !v)} className="btn btn-secondary">{showFinder ? 'Close finder' : '⌕ Find leads'}</button>
            <button onClick={() => setShowImport(true)} className="btn btn-secondary">↑ Import CSV</button>
            <button onClick={handleCsvExport} disabled={contacts.length === 0} className="btn btn-secondary">↓ Export CSV</button>
            <VerifyAllButton clientId={id} onDone={() => { /* parent refresh via badge in place */ }} disabled={contacts.length === 0} />
            {selectedContacts.size > 0 && (
              <button onClick={handleBulkDelete} className="btn btn-danger">Delete {selectedContacts.size} selected</button>
            )}
          </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button onClick={runIcpScrape} disabled={icpScraping || (!aud.industry && !aud.specialisation)} className="btn btn-secondary">
                  {icpScraping ? 'Scraping…' : '✦ Scrape all (free)'}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {icpScraping || scrapeRun
                    ? `Crawling ${scrapeRun?.sites_done || 0}/${scrapeRun?.sites_total || 0} sites · ${scrapeRun?.found_count || 0} contacts so far`
                    : 'Finds sites for this audience and scrapes leads from each — no per-lookup cost.'}
                </span>
              </div>
              {deepProviders.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid #eee', margin: '14px 0 8px', paddingTop: 14, fontWeight: 600, fontSize: 13 }}>Or dig deeper (paid data)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select className="input" style={{ width: 170 }} value={deepProvider} onChange={e => setDeepProvider(e.target.value)}>
                      {deepProviders.map(p => <option key={p} value={p}>{PROVIDER_LABEL[p] || p}</option>)}
                    </select>
                    <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Job titles — e.g. founder, head of marketing" value={deepTitles} onChange={e => setDeepTitles(e.target.value)} />
                    <button onClick={runDeepFind} disabled={deepLoading} className="btn btn-primary">{deepLoading ? '…' : 'Find leads'}</button>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '6px 0 0' }}>Uses the audience fields above (industry / location / keywords) + titles. Costs per lookup on the provider — use when the free path comes up short.</p>
                </>
              )}
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
              <div style={{ borderTop: '1px solid #eee', margin: '14px 0 8px', paddingTop: 14, fontWeight: 600, fontSize: 13 }}>Or scrape a page (free)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder="Page URL — a Contact/Team page, directory or listing"
                  value={scrapeUrlInput} onChange={e => setScrapeUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runScrape(scrapeUrlInput); }} />
                <button onClick={() => runScrape(scrapeUrlInput, false)} disabled={finding} className="btn btn-primary" title="Just this page">{finding ? '…' : 'Scrape page'}</button>
                <button onClick={() => runScrape(scrapeUrlInput, true)} disabled={finding} className="btn btn-secondary" title="This page plus its Contact / About / Team pages">{finding ? '…' : 'Scrape site'}</button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '6px 0 0' }}>Free — reads the page and pulls any leads on it. No per-lookup cost; use Hunter/Icypeas as a fallback for email guessing.</p>
              {findError && <p style={{ color: 'var(--negative)', fontSize: 12, margin: '8px 0 0' }}>{findError}</p>}
              {searched && foundContacts.length === 0 && !findError && (
                <p style={{ color: 'var(--text-subtle)', fontSize: 12, margin: '8px 0 0' }}>No leads found.</p>
              )}
              {foundContacts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {/* Rank the results by fit against the client's ICP + service
                      criteria before adding — score each lead 0–100. */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Rank by fit — describe your ideal lead / service criteria"
                      value={rankCriteria} onChange={e => setRankCriteria(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') runRank(); }} />
                    <button {...roWrite(readOnly, { onClick: runRank, disabled: ranking, title: 'Score each lead 0–100 for fit against these criteria, best first' })} className="btn btn-secondary">
                      {ranking ? 'Ranking…' : '★ Rank by fit'}
                    </button>
                  </div>
                  <table className="table">
                    <thead><tr>{['', 'Fit', 'Name', 'Email', 'Role', 'Confidence'].map(h => <th key={h} >{h}</th>)}</tr></thead>
                    <tbody>
                      {foundContacts.map((c, i) => (
                        <tr key={i}>
                          <td ><input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelected(i)} /></td>
                          <td >{c.fit_score == null ? '—' : (
                            <span title={c.fit_reason || ''} style={{ fontWeight: 700, color: fitColor(c.fit_score) }}>{c.fit_score}</span>
                          )}</td>
                          <td >{c.name || '—'}</td>
                          <td >{c.email}</td>
                          <td >{c.role || '—'}</td>
                          <td >{c.confidence == null ? '—' : (typeof c.confidence === 'number' ? `${c.confidence}%` : c.confidence)}</td>
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
              <button type="submit" className="btn btn-primary" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>Add lead</button>
            </form>
          )}

          {/* CSV import column reference */}
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 12 }}>
            CSV columns — required: <code>email</code>. Optional: <code>first_name</code>, <code>last_name</code>, <code>company</code>, <code>contact_type</code>, <code>title</code>, <code>location</code>, <code>linkedin_url</code>, <code>notes</code>.
          </p>

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
                    {contacts.length === 0 ? 'No leads yet — add manually, find new, or import a CSV.' : 'No leads match these filters.'}
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
                      <button onClick={() => deleteContact(c.id)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>
            Showing {filteredContacts.length} of {contacts.length} lead{contacts.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {editingContact && (
        <EditContactModal
          contact={editingContact}
          entityLabel="lead"
          onClose={() => setEditingContact(null)}
          onSaved={onContactUpdated}
        />
      )}

      <ImportWizard
        open={showImport}
        onClose={() => setShowImport(false)}
        entityLabel="lead"
        clientIdForAttach={id}
        onImported={async () => {
          try {
            const fresh = await api.get(`/outreach/contacts?client_id=${id}&kind=prospect,industry`);
            setContacts(fresh);
          } catch (err) { toast(err.message, 'error'); }
        }}
      />


      {tab === 'campaigns' && wizardCampaignId && (
        <CampaignWizard
          clientId={id} campaignId={wizardCampaignId}
          onExit={() => { setWizardCampaignId(null); refreshCampaigns(); }}
          onCampaignChange={refreshCampaigns}
        />
      )}

      {showNewCampaign && (
        <NewCampaignModal
          clientId={id}
          onClose={() => setShowNewCampaign(false)}
          onCreated={(c) => {
            setShowNewCampaign(false);
            setCampaigns(prev => [{ ...c, contact_count: 0 }, ...prev]);
            setTab('campaigns');
            setWizardCampaignId(c.id);
          }}
          onPickSelective={() => {
            // Selective runs on its own engine/sending identity — hand off to
            // that lane's tab, where the AM names the campaign and sets the ICP.
            setShowNewCampaign(false);
            setTab('prospecting');
          }}
        />
      )}

      {tab === 'campaigns' && !wizardCampaignId && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowNewCampaign(true)} className="btn btn-primary">+ New campaign</button>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr>{['Campaign', 'Brand', 'Status', 'Leads', 'Sent / Total', 'Created', ''].map(h => <th key={h} >{h}</th>)}</tr></thead>
              <tbody>
                {outreachCampaigns.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>No campaigns yet — click “+ New campaign” to start the wizard.</td></tr>
                ) : outreachCampaigns.map(c => (
                  <tr key={c.id}>
                    <td >
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.audience_description && <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.audience_description.slice(0, 80)}{c.audience_description.length > 80 ? '…' : ''}</div>}
                    </td>
                    <td >{c.brand || '—'}</td>
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
                      <button onClick={() => deleteCampaign(c.id)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }}>Delete</button>
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
// Escape a single value for CSV — double-quote and escape inner quotes if the
// value contains anything CSV-sensitive.
// Page-local style shorthand. All values now flow from the global
// design tokens (--accent, --border-w, etc) so this page picks up the
// suite-email accent automatically and matches every other page's
// border / radius / padding.

// Bulk verify — hits the server's verify-all endpoint which walks
// every contact attached to any campaign on this client and runs the
// verifier for each. Returns a tally so the AM sees how the pool
// breaks down (valid / risky / invalid / unknown / errored).
function VerifyAllButton({ clientId, onDone, disabled }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  async function run() {
    if (!confirm('Verify every lead for this client? Uses Hunter credits for any unverified or stale rows.')) return;
    setBusy(true);
    try {
      const r = await api.post(`/outreach/clients/${clientId}/contacts/verify-all`, {});
      toast(`Checked ${r.checked} — ${r.valid} valid, ${r.risky} risky, ${r.invalid} invalid, ${r.unknown} unknown${r.errored ? `, ${r.errored} errored` : ''}.`, 'success');
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  }
  return (
    <button onClick={run} disabled={disabled || busy} className="btn btn-secondary">
      {busy ? 'Verifying…' : '✓ Verify all'}
    </button>
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

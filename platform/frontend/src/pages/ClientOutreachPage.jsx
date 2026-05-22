import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
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
  const [sendCfg, setSendCfg] = useState({});
  const [savingSend, setSavingSend] = useState(false);
  const [sendSaved, setSendSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/outreach/contacts?client_id=${id}`),
      api.get(`/outreach/campaigns?client_id=${id}`),
    ])
      .then(([c, ct, cp]) => { setClient(c); setContacts(ct); setCampaigns(cp); setSendCfg(c.outreach_sending || {}); })
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

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Outreach — {client?.name}</h1>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
        AI cold-outreach: contacts and campaigns. Contact finding, Claude-drafted email sequences and sending are coming in the next passes.
      </p>

      <div style={{ display: 'flex', marginBottom: 16 }}>
        {[['contacts', `Contacts (${contacts.length})`], ['campaigns', `Campaigns (${campaigns.length})`], ['sending', 'Sending']].map(([v, label], i, arr) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '6px 16px', fontSize: 13, cursor: 'pointer', border: '1px solid #ddd',
            background: tab === v ? '#1a1a1a' : '#fff', color: tab === v ? '#fff' : '#444',
            borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : '0',
            borderLeft: i === 0 ? '1px solid #ddd' : 'none',
          }}>{label}</button>
        ))}
      </div>

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
          <div style={{ ...s.tableWrap, marginTop: 12 }}>
            <table style={s.table}>
              <thead><tr>{['Name', 'Email', 'Company', 'Role', 'Status', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No contacts yet — add one above</td></tr>
                ) : contacts.map(c => (
                  <tr key={c.id}>
                    <td style={s.td}>{c.name || '—'}</td>
                    <td style={s.td}>{c.email || '—'}</td>
                    <td style={s.td}>{c.company || '—'}</td>
                    <td style={s.td}>{c.role || '—'}</td>
                    <td style={s.td}><span style={s.chip}>{c.status}</span></td>
                    <td style={s.td}><button onClick={() => deleteContact(c.id)} title="Delete" style={s.del}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'campaigns' && (
        <div>
          <button onClick={() => setShowAddCampaign(v => !v)} style={s.btn}>{showAddCampaign ? 'Cancel' : '+ New campaign'}</button>
          {showAddCampaign && (
            <form onSubmit={addCampaign} style={{ ...s.card, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input style={s.input} placeholder="Campaign name" value={newCampaign.name}
                required onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} />
              <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }}
                placeholder="Audience description — who are we reaching out to, and why?"
                value={newCampaign.audience_description}
                onChange={e => setNewCampaign(p => ({ ...p, audience_description: e.target.value }))} />
              <button type="submit" style={{ ...s.btn, alignSelf: 'start' }}>Create campaign</button>
            </form>
          )}
          <div style={{ ...s.tableWrap, marginTop: 12 }}>
            <table style={s.table}>
              <thead><tr>{['Campaign', 'Status', 'Contacts', 'Created', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No campaigns yet — create one above</td></tr>
                ) : campaigns.map(c => (
                  <React.Fragment key={c.id}>
                  <tr style={{ cursor: 'pointer', background: expandedCampaign === c.id ? '#fafafa' : undefined }}
                    onClick={() => setExpandedCampaign(v => (v === c.id ? null : c.id))}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{expandedCampaign === c.id ? '▾ ' : '▸ '}{c.name}</div>
                      {c.audience_description && <div style={{ fontSize: 11, color: '#999' }}>{c.audience_description}</div>}
                    </td>
                    <td style={s.td}><span style={s.chip}>{c.status}</span></td>
                    <td style={s.td}>{c.contact_count || 0}</td>
                    <td style={s.td}>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                    <td style={s.td} onClick={e => e.stopPropagation()}><button onClick={() => deleteCampaign(c.id)} title="Delete" style={s.del}>×</button></td>
                  </tr>
                  {expandedCampaign === c.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0, background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                        <CampaignSequence campaign={c} onCampaignChange={refreshCampaigns} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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

const s = {
  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 },
  btn: { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  btnGhost: { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' },
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' },
  tableWrap: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '11px 16px', borderBottom: '1px solid #f5f5f5', fontSize: 13, verticalAlign: 'middle' },
  chip: { fontSize: 11, background: '#eee', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' },
  del: { background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1, padding: '0 4px' },
};

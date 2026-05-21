import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/outreach/contacts?client_id=${id}`),
      api.get(`/outreach/campaigns?client_id=${id}`),
    ])
      .then(([c, ct, cp]) => { setClient(c); setContacts(ct); setCampaigns(cp); })
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

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Outreach — {client?.name}</h1>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
        AI cold-outreach: contacts and campaigns. Contact finding, Claude-drafted email sequences and sending are coming in the next passes.
      </p>

      <div style={{ display: 'flex', marginBottom: 16 }}>
        {[['contacts', `Contacts (${contacts.length})`], ['campaigns', `Campaigns (${campaigns.length})`]].map(([v, label], i) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '6px 16px', fontSize: 13, cursor: 'pointer', border: '1px solid #ddd',
            background: tab === v ? '#1a1a1a' : '#fff', color: tab === v ? '#fff' : '#444',
            borderRadius: i === 0 ? '4px 0 0 4px' : '0 4px 4px 0', borderLeft: i === 0 ? '1px solid #ddd' : 'none',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'contacts' && (
        <div>
          <button onClick={() => setShowAddContact(v => !v)} style={s.btn}>{showAddContact ? 'Cancel' : '+ Add contact'}</button>
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
                  <tr key={c.id}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.audience_description && <div style={{ fontSize: 11, color: '#999' }}>{c.audience_description}</div>}
                    </td>
                    <td style={s.td}><span style={s.chip}>{c.status}</span></td>
                    <td style={s.td}>{c.contact_count || 0}</td>
                    <td style={s.td}>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                    <td style={s.td}><button onClick={() => deleteCampaign(c.id)} title="Delete" style={s.del}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 },
  btn: { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' },
  tableWrap: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '11px 16px', borderBottom: '1px solid #f5f5f5', fontSize: 13, verticalAlign: 'middle' },
  chip: { fontSize: 11, background: '#eee', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' },
  del: { background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1, padding: '0 4px' },
};

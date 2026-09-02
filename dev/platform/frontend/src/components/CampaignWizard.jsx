import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';
// 5-step Campaign Wizard. The component manages step state locally and
// persists each step's data to the backend on Next so the user can resume
// a draft campaign mid-flow if they leave.
//
// Steps: 1 Campaign · 2 Audience · 3 Contacts · 4 Emails · 5 Launch
const STEPS = [
  { key: 1, label: 'Campaign' },
  { key: 2, label: 'Audience' },
  { key: 3, label: 'Leads' },
  { key: 4, label: 'Emails' },
  { key: 5, label: 'Launch' },
];

export default function CampaignWizard({ clientId, campaignId, onExit, onCampaignChange }) {
  const toast = useToast();
  const [campaign, setCampaign] = useState(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    api.get(`/outreach/campaigns?client_id=${clientId}`)
      .then(rows => {
        const found = rows.find(c => c.id === campaignId);
        if (found) {
          setCampaign(found);
          // Resume at the furthest step the AM reached. wizard_step is
          // a monotonic high-water mark persisted by persistAndNext —
          // for fresh campaigns it stays 1; reopening a draft jumps
          // straight back to step N instead of forcing a click-through.
          if (found.wizard_step && found.wizard_step > 1) setStep(found.wizard_step);
        }
      })
      .catch(err => toast(err.message, 'error'));
  }, [campaignId, clientId]);

  // High-water mark of how far the AM has progressed. Drives breadcrumb
  // enabled state so they can jump back and forth across every step
  // they've already saved.
  const maxReached = Math.max(step, campaign?.wizard_step || 1);

  function updateCampaign(patch) {
    setCampaign(prev => ({ ...prev, ...patch }));
  }

  async function persistAndNext(patch = {}) {
    if (!campaign) return;
    setBusy(true);
    try {
      const next = Math.min(step + 1, 5);
      const updated = await api.put(`/outreach/campaigns/${campaign.id}`, {
        ...patch,
        wizard_step: next,
      });
      setCampaign(updated);
      if (onCampaignChange) onCampaignChange();
      setStep(next);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) {
    return <div style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading campaign…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button onClick={onExit} className="btn btn-secondary">← Campaigns</button>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{campaign.name || 'New campaign'}</div>
        <div style={{ width: 100 }} />
      </div>

      {/* Breadcrumb / step indicator — yellow dot for current and completed steps */}
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: `1px solid ${'var(--accent-soft)'}`, borderRadius: 'var(--r-pill)', padding: '6px 12px', marginBottom: 24 }}>
        {STEPS.map(({ key, label }, idx) => {
          // Click freely up to the high-water mark — both back and
          // forward — so reopening a draft doesn't force re-entering
          // earlier steps.
          const reachable = key <= maxReached;
          return (
            <React.Fragment key={key}>
              <button
                onClick={() => reachable && setStep(key)}
                disabled={!reachable}
                style={{
                  display: 'flex', alignItems: 'center',
                  background: 'none', border: 'none',
                  cursor: reachable ? 'pointer' : 'default',
                  padding: '6px 8px', fontSize: 13,
                  fontWeight: step === key ? 700 : 500,
                  color: reachable ? 'var(--text)' : 'var(--text-subtle)',
                  flexShrink: 0,
                }}>
                <span className={`chip ${reachable ? 'chip-accent' : 'chip-neutral'}`} style={{ width: 24, height: 24, justifyContent: 'center', marginRight: 8, fontSize: 12, fontWeight: 700 }}>{key}</span>
                {label}
              </button>
              {idx < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1, background: 'var(--accent-soft)', margin: '0 4px' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {step === 1 && <StepCampaignDetails campaign={campaign} updateCampaign={updateCampaign} busy={busy} onNext={() => persistAndNext({
        name: campaign.name, brand: campaign.brand, campaign_type: campaign.campaign_type,
        from_name: campaign.from_name, from_email: campaign.from_email, reply_to: campaign.reply_to,
        coupon_code: campaign.coupon_code, press_release_url: campaign.press_release_url,
      })} />}
      {step === 2 && <StepAudience campaign={campaign} setCampaign={setCampaign} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <StepContacts campaign={campaign} clientId={clientId} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
      {step === 4 && <StepEmails campaign={campaign} onBack={() => setStep(3)} onNext={() => setStep(5)} />}
      {step === 5 && <StepLaunch campaign={campaign} onBack={() => setStep(4)} onExit={onExit} onCampaignChange={onCampaignChange} />}
    </div>
  );
}

// ─── Step 1 ─────────────────────────────────────────────────────────────────
function StepCampaignDetails({ campaign, updateCampaign, busy, onNext }) {
  const type = campaign.campaign_type || 'outreach';
  return (
    <div className="card">
      <H>Campaign Details</H>
      <Grid2>
        <Field label="Campaign name">
          <input className="input" value={campaign.name || ''} onChange={e => updateCampaign({ name: e.target.value })} placeholder="e.g. ADF 2026 Tour Submissions" />
        </Field>
        <Field label="Brand">
          <input className="input" value={campaign.brand || ''} onChange={e => updateCampaign({ brand: e.target.value })} placeholder="e.g. October Comms" />
        </Field>
        <Field label="Type">
          <select className="input" value={type} onChange={e => updateCampaign({ campaign_type: e.target.value })}>
            <option value="outreach">Outreach</option>
            <option value="press_release">Press Release</option>
          </select>
        </Field>
        <div />
        <Field label="From name">
          <input className="input" value={campaign.from_name || ''} onChange={e => updateCampaign({ from_name: e.target.value })} placeholder="e.g. James Nelson" />
        </Field>
        <Field label="From email">
          <input className="input" value={campaign.from_email || ''} onChange={e => updateCampaign({ from_email: e.target.value })} placeholder="james@brand.example" />
        </Field>
        <Field label="Reply-To email">
          <input className="input" value={campaign.reply_to || ''} onChange={e => updateCampaign({ reply_to: e.target.value })} placeholder="replies@octobercomms.com" />
        </Field>
        <div />
        {type === 'press_release' && (
          <Field label="Press release URL" full>
            <input className="input" value={campaign.press_release_url || ''} onChange={e => updateCampaign({ press_release_url: e.target.value })} placeholder="https://…" />
          </Field>
        )}
        {type === 'outreach' && (
          <Field label="Coupon code (optional)">
            <input className="input" value={campaign.coupon_code || ''} onChange={e => updateCampaign({ coupon_code: e.target.value })} placeholder="e.g. WELCOME20" />
          </Field>
        )}
      </Grid2>
      <Footer>
        <button disabled={busy || !campaign.name} onClick={onNext} className="btn btn-primary">{busy ? 'Saving…' : 'Next: Audience →'}</button>
      </Footer>
    </div>
  );
}

// ─── Step 2 ─────────────────────────────────────────────────────────────────
function StepAudience({ campaign, setCampaign, onBack, onNext }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [audience, setAudience] = useState(campaign.audience_description || '');
  const [extra, setExtra] = useState('');
  const [excludeSearched, setExcludeSearched] = useState(true);
  const [perDomain, setPerDomain] = useState(25);
  const [refining, setRefining] = useState(false);
  const refined = campaign.refined_audience || null;

  async function refine() {
    setRefining(true);
    try {
      const result = await api.post(`/outreach/campaigns/${campaign.id}/refine-audience`, {
        audience_description: audience, extra_instructions: extra, exclude_searched: excludeSearched,
      });
      setCampaign(prev => ({ ...prev, refined_audience: result, audience_description: audience }));
      toast('Audience refined by Claude', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRefining(false);
    }
  }

  function removeDomain(idx) {
    const next = { ...refined, domains: refined.domains.filter((_, i) => i !== idx) };
    setCampaign(prev => ({ ...prev, refined_audience: next }));
  }
  function removeTitle(idx) {
    const next = { ...refined, job_titles: refined.job_titles.filter((_, i) => i !== idx) };
    setCampaign(prev => ({ ...prev, refined_audience: next }));
  }
  function addDomain(d) {
    const dom = String(d).trim().toLowerCase();
    if (!dom || refined.domains.includes(dom)) return;
    const next = { ...refined, domains: [...refined.domains, dom] };
    setCampaign(prev => ({ ...prev, refined_audience: next }));
  }

  return (
    <div className="card">
      <H>Audience</H>
      <Field label="Describe the audience in plain English" full>
        <textarea className="input" style={{ minHeight: 80, resize: 'vertical' }} value={audience} onChange={e => setAudience(e.target.value)}
          placeholder="e.g. Small to mid-size architecture firms in Atlanta working on residential and commercial projects" />
      </Field>
      <Field label="Extra instructions for Claude (optional)" full>
        <textarea className="input" style={{ minHeight: 60, resize: 'vertical' }} value={extra} onChange={e => setExtra(e.target.value)}
          placeholder="e.g. Prioritise firms with sustainability focus" />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 4, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={excludeSearched} onChange={e => setExcludeSearched(e.target.checked)} />
          Exclude domains already searched ({(campaign.searched_domains || []).length})
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Contacts per domain
          <select className="input" style={{ padding: '4px 6px', fontSize: 12 }} value={perDomain} onChange={e => setPerDomain(parseInt(e.target.value, 10))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
        <button {...roWrite(readOnly, { onClick: refine, disabled: refining || !audience.trim() })} className="btn btn-primary">
          {refining ? 'Refining…' : (refined ? '↻ Re-refine with Claude' : '✦ Refine with Claude')}
        </button>
      </div>

      {refined && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Refined description</div>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 12px', lineHeight: 1.6 }}>{refined.refined_description}</p>
          {refined.rationale && (
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic', margin: '0 0 14px' }}>{refined.rationale}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                Target domains ({refined.domains.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {refined.domains.map((d, i) => (
                  <Tag key={d + i} onRemove={() => removeDomain(i)}>{d}</Tag>
                ))}
              </div>
              <AddPill onAdd={addDomain} placeholder="+ add domain" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                Job titles ({refined.job_titles.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {refined.job_titles.map((t, i) => (
                  <Tag key={t + i} onRemove={() => removeTitle(i)}>{t}</Tag>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer>
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <button onClick={async () => {
          if (refined) {
            await api.put(`/outreach/campaigns/${campaign.id}`, { refined_audience: refined, audience_description: audience });
          }
          onNext();
        }} disabled={!refined} className="btn btn-primary">
          Next: Find Contacts →
        </button>
      </Footer>
    </div>
  );
}

// ─── Step 3 ─────────────────────────────────────────────────────────────────
function StepContacts({ campaign, clientId, onBack, onNext }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [mode, setMode] = useState('find');
  const [batchIdx, setBatchIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const [foundContacts, setFoundContacts] = useState([]);
  const [selectedFound, setSelectedFound] = useState(() => new Set());
  const [existing, setExisting] = useState([]);
  const [selectedExisting, setSelectedExisting] = useState(() => new Set());
  const [filter, setFilter] = useState({ contact_type: '', location: '', search: '' });
  const [saving, setSaving] = useState(false);

  const refined = campaign.refined_audience || { domains: [], job_titles: [] };
  const allDomains = refined.domains || [];
  const remaining = allDomains.slice(batchIdx * 8);
  const nextBatch = remaining.slice(0, 8);

  useEffect(() => {
    if (mode !== 'existing') return;
    const params = new URLSearchParams({ client_id: clientId, exclude_campaign: campaign.id, kind: 'prospect,industry' });
    if (filter.contact_type) params.set('contact_type', filter.contact_type);
    if (filter.location) params.set('location', filter.location);
    if (filter.search) params.set('search', filter.search);
    api.get(`/outreach/contacts?${params}`).then(setExisting).catch(() => setExisting([]));
  }, [mode, filter, campaign.id, clientId]);

  async function searchNext() {
    if (nextBatch.length === 0) return;
    setSearching(true);
    try {
      const res = await api.post(`/outreach/campaigns/${campaign.id}/search-batch`, {
        domains: nextBatch, job_titles: refined.job_titles || [], contacts_per_domain: 25,
      });
      setFoundContacts(prev => mergeUniqueByEmail([...prev, ...(res.contacts || [])]));
      setBatchIdx(i => i + 1);
      toast(`Found ${res.contacts.length} lead${res.contacts.length === 1 ? '' : 's'} across ${nextBatch.length} domains`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSearching(false);
    }
  }

  function toggleFound(i) {
    setSelectedFound(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }
  function toggleExisting(id) {
    setSelectedExisting(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveAndContinue() {
    const new_contacts = foundContacts.filter((_, i) => selectedFound.has(i));
    const contact_ids = [...selectedExisting];
    if (new_contacts.length === 0 && contact_ids.length === 0) {
      toast('Select at least one lead first', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/outreach/campaigns/${campaign.id}/contacts/add`, { new_contacts, contact_ids });
      toast(`Added ${res.added} lead${res.added === 1 ? '' : 's'} to the campaign`, 'success');
      onNext();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const totalSelected = selectedFound.size + selectedExisting.size;

  return (
    <div className="card">
      <H>Find Leads</H>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode('find')} className={`btn btn-sm ${mode === 'find' ? 'btn-primary' : 'btn-secondary'}`}>Find new leads</button>
        <button onClick={() => setMode('existing')} className={`btn btn-sm ${mode === 'existing' ? 'btn-primary' : 'btn-secondary'}`}>Existing leads</button>
      </div>

      {mode === 'find' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Searching domains <strong>{batchIdx * 8 + 1}</strong>–<strong>{Math.min((batchIdx + 1) * 8, allDomains.length)}</strong> of {allDomains.length}
            </div>
            <button {...roWrite(readOnly, { onClick: searchNext, disabled: searching || nextBatch.length === 0 })} className="btn btn-primary">
              {searching ? 'Searching…' : nextBatch.length === 0 ? 'No more domains' : `Search next ${nextBatch.length} ${nextBatch.length === 1 ? 'domain' : 'domains'}`}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Hunter.io + Icypeas in parallel, deduped by email.</span>
          </div>
          {foundContacts.length > 0 && (
            <ResultsTable rows={foundContacts} selected={selectedFound} onToggle={toggleFound} />
          )}
          {foundContacts.length === 0 && batchIdx === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Click “Search next” above to start finding leads at the refined-audience domains.</p>
          )}
        </div>
      )}

      {mode === 'existing' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            <input className="input" placeholder="Search name / email / company" value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
            <input className="input" placeholder="Lead type — e.g. architect" value={filter.contact_type}
              onChange={e => setFilter(f => ({ ...f, contact_type: e.target.value }))} />
            <input className="input" placeholder="Location keyword" value={filter.location}
              onChange={e => setFilter(f => ({ ...f, location: e.target.value }))} />
          </div>
          {existing.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No leads match these filters.</p>
          ) : (
            <ExistingTable rows={existing} selected={selectedExisting} onToggle={toggleExisting} />
          )}
        </div>
      )}

      <Footer>
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalSelected} selected</span>
        <button onClick={saveAndContinue} disabled={saving || totalSelected === 0} className="btn btn-primary">
          {saving ? 'Saving…' : 'Next: Write Emails →'}
        </button>
      </Footer>
    </div>
  );
}

// ─── Step 4 ─────────────────────────────────────────────────────────────────
function StepEmails({ campaign, onBack, onNext }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [steps, setSteps] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [savingStep, setSavingStep] = useState(null);
  const [previewStep, setPreviewStep] = useState(null);    // { stepId, ... }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testingStep, setTestingStep] = useState(null);

  async function openPreview(stp) {
    setPreviewLoading(true);
    setPreviewStep({ stepId: stp.id, step_number: stp.step_number });
    try {
      // Auto-save the in-memory edits first so the preview reflects
      // whatever the AM has typed, not the last persisted version.
      await api.put(`/outreach/sequences/${stp.id}`, {
        subject: stp.subject, body: stp.body, delay_days: stp.delay_days,
      });
      const r = await api.post(`/outreach/sequences/${stp.id}/preview`, {});
      setPreviewStep(p => ({ ...p, ...r }));
    } catch (err) {
      toast(err.message, 'error');
      setPreviewStep(null);
    } finally { setPreviewLoading(false); }
  }

  async function sendTest(stp) {
    const to = window.prompt(`Send a test of step ${stp.step_number} to which email?`);
    if (!to) return;
    setTestingStep(stp.id);
    try {
      await api.put(`/outreach/sequences/${stp.id}`, {
        subject: stp.subject, body: stp.body, delay_days: stp.delay_days,
      });
      await api.post(`/outreach/sequences/${stp.id}/test`, { to });
      toast(`Test sent to ${to}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setTestingStep(null); }
  }

  useEffect(() => {
    api.get(`/outreach/campaigns/${campaign.id}/sequences`).then(setSteps).catch(() => setSteps([]));
  }, [campaign.id]);

  async function generate() {
    setGenerating(true);
    try {
      const seq = await api.post(`/outreach/campaigns/${campaign.id}/generate`, {});
      setSteps(seq);
      toast('Sequence drafted by Claude', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setGenerating(false); }
  }

  function updateStep(stepId, field, value) {
    setSteps(prev => prev.map(st => (st.id === stepId ? { ...st, [field]: value } : st)));
  }

  async function saveStep(stepRow) {
    setSavingStep(stepRow.id);
    try {
      await api.put(`/outreach/sequences/${stepRow.id}`, {
        subject: stepRow.subject, body: stepRow.body, delay_days: stepRow.delay_days,
      });
      toast(`Step ${stepRow.step_number} saved`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSavingStep(null); }
  }

  return (
    <div className="card">
      <H>Write Emails</H>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button {...roWrite(readOnly, { onClick: generate, disabled: generating })} className="btn btn-primary">
          {generating ? 'Drafting…' : (steps && steps.length ? '↻ Regenerate with Claude' : '✦ Generate sequence with Claude')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>3 emails — initial, follow-up at day 4, final nudge at day 9.</span>
      </div>
      {steps === null && <p style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</p>}
      {steps !== null && steps.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No sequence yet — generate one with Claude.</p>}
      {steps && steps.map(stp => (
        <div key={stp.id} style={{ background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Step {stp.step_number} · sent day {stp.delay_days}
          </div>
          <input className="input" style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
            value={stp.subject || ''} placeholder="Subject"
            onChange={e => updateStep(stp.id, 'subject', e.target.value)} />
          <textarea className="input" style={{ width: '100%', minHeight: 120, resize: 'vertical', boxSizing: 'border-box' }}
            value={stp.body || ''} placeholder="Email body — use {{first_name}}, {{company}}"
            onChange={e => updateStep(stp.id, 'body', e.target.value)} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <button onClick={() => saveStep(stp)} disabled={savingStep === stp.id} className="btn btn-primary">
              {savingStep === stp.id ? 'Saving…' : 'Save step'}
            </button>
            <button onClick={() => openPreview(stp)} className="btn btn-secondary" title="See how this step looks to a recipient">
              Preview as lead
            </button>
            <button {...roWrite(readOnly, { onClick: () => sendTest(stp), disabled: testingStep === stp.id, title: 'Send a [TEST]-prefixed copy of this step to an email of your choice' })} className="btn btn-secondary">
              {testingStep === stp.id ? 'Sending…' : 'Send test to me'}
            </button>
          </div>
        </div>
      ))}
      <Footer>
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <button onClick={onNext} disabled={!steps || steps.length === 0} className="btn btn-primary">Next: Launch →</button>
      </Footer>

      {previewStep && (
        <div style={previewOverlay} onClick={() => setPreviewStep(null)}>
          <div style={previewModal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                  Step {previewStep.step_number} preview
                </div>
                {previewStep.sample && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    As if sent to: <strong>{previewStep.sample.name || previewStep.sample.email}</strong>
                    {previewStep.sample.company && <> · {previewStep.sample.company}</>}
                  </div>
                )}
              </div>
              <button onClick={() => setPreviewStep(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-subtle)' }}>×</button>
            </div>
            {previewLoading || !previewStep.html ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-subtle)' }}>Rendering…</div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Subject</div>
                <div style={{ padding: '8px 10px', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 12, fontSize: 13 }}>
                  {previewStep.subject || <em style={{ color: 'var(--text-subtle)' }}>(empty)</em>}
                </div>
                <iframe srcDoc={previewStep.html} title="Preview" style={{ width: '100%', height: 480, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }} sandbox="" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const previewOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1100, overflowY: 'auto' };
const previewModal = { background: 'var(--surface)', borderRadius: 'var(--r-sm)', width: '100%', maxWidth: 760, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };

// ─── Step 5 ─────────────────────────────────────────────────────────────────
function StepLaunch({ campaign, onBack, onExit, onCampaignChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/outreach/campaigns/${campaign.id}/readiness`)
      .then(setReport)
      .catch(err => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  async function launch() {
    if (report?.blockers?.length) return;   // belt-and-braces; button is disabled anyway
    if (!window.confirm('Launch this campaign? The first email will start sending immediately to all enrolled leads.')) return;
    setBusy(true);
    try {
      const res = await api.post(`/outreach/campaigns/${campaign.id}/launch`, {});
      toast(`Launched — ${res.enrolled} lead${res.enrolled === 1 ? '' : 's'} enrolled`, 'success');
      if (onCampaignChange) onCampaignChange();
      onExit();
    } catch (err) {
      toast(err.message, 'error');
    } finally { setBusy(false); }
  }

  const blockers = report?.blockers || [];
  const warnings = report?.warnings || [];
  const stats = report?.stats || {};

  return (
    <div className="card">
      <H>Pre-send report</H>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>Quick check before the campaign goes out — blockers stop the launch, warnings are worth a look.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <Summary label="Campaign" value={campaign.name} />
        <Summary label="Brand" value={campaign.brand || '—'} />
        <Summary label="Type" value={campaign.campaign_type === 'press_release' ? 'Press Release' : 'Outreach'} />
        <Summary label="From" value={campaign.from_email ? `${campaign.from_name || ''} <${campaign.from_email}>` : '—'} />
        <Summary label="Reply-To" value={campaign.reply_to || '—'} />
        <Summary label="Leads enrolled" value={String(campaign.contact_count || 0)} />
      </div>

      {loading && <div style={{ marginTop: 18, color: 'var(--text-subtle)', fontSize: 13 }}>Running readiness checks…</div>}

      {!loading && (
        <>
          {/* Blockers — red, prevent launch */}
          <ReportSection
            title={`✗ Blockers (${blockers.filter(b => b.severity !== 'info').length})`}
            empty="No blockers — good to go."
            items={blockers}
            tone="error"
          />

          {/* Warnings — yellow, allow launch but flag */}
          <ReportSection
            title={`⚠ Warnings (${warnings.filter(w => w.severity !== 'info').length})`}
            empty="No warnings."
            items={warnings}
            tone="warn"
          />

          {/* Stats — informational */}
          <div style={{ marginTop: 18, padding: 12, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Stats</div>
            <div>Recipients: <strong>{stats.total_recipients ?? 0}</strong></div>
            {stats.previously_bounced != null && <div>Previously bounced (will be skipped): <strong>{stats.previously_bounced}</strong></div>}
            {stats.previously_unsubscribed != null && <div>Previously unsubscribed (will be skipped): <strong>{stats.previously_unsubscribed}</strong></div>}
            {stats.free_mail != null && <div>Free-mail addresses (gmail / hotmail / etc): <strong>{stats.free_mail}</strong></div>}
            {stats.duplicates ? <div>Duplicate emails in list: <strong>{stats.duplicates}</strong></div> : null}
            {stats.sending_domain && <div>Sending domain: <strong>{stats.sending_domain}</strong> — SPF {stats.dns?.spf}, DKIM {stats.dns?.dkim}, DMARC {stats.dns?.dmarc}</div>}
            {stats.ses?.in_sandbox === true && <div style={{ color: 'var(--negative)' }}>SES: in sandbox</div>}
            {stats.ses?.in_sandbox === false && <div>SES: production access</div>}
            {stats.ses?.in_sandbox == null && stats.ses?.configured && <div>SES status unknown ({stats.ses.error || 'no GetAccount response'})</div>}
            {stats.estimated_send_days ? <div>Estimated send window: <strong>~{stats.estimated_send_days} day{stats.estimated_send_days === 1 ? '' : 's'}</strong> at standard pacing</div> : null}
          </div>
        </>
      )}

      <Footer>
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <button onClick={launch}
          disabled={busy || loading || !campaign.contact_count || blockers.length > 0}
          title={blockers.length ? 'Resolve blockers before launching' : undefined}
          className="btn btn-primary">
          {busy ? 'Launching…' : '▶ Launch campaign'}
        </button>
      </Footer>
    </div>
  );
}

// One block of report findings (blockers or warnings). Tone drives
// the colour; an "info" severity slips into the warnings list with
// muted styling.
function ReportSection({ title, empty, items, tone }) {
  const palette = tone === 'error'
    ? { bg: 'var(--negative-soft)', border: 'var(--negative)', fg: 'var(--negative)' }
    : { bg: 'var(--warning-soft)', border: 'var(--warning)', fg: 'var(--warning)' };
  if (!items.length) {
    return (
      <div style={{ marginTop: 14, padding: '8px 12px', background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', borderRadius: 'var(--r-sm)', fontSize: 12 }}>
        ✓ {empty}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 14, padding: '10px 12px', background: palette.bg, border: `1px solid ${palette.border}`, color: palette.fg, borderRadius: 'var(--r-sm)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.55 }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 3, opacity: it.severity === 'info' ? 0.75 : 1 }}>{it.msg}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function mergeUniqueByEmail(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const k = (c.email || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}
function ResultsTable({ rows, selected, onToggle }) {
  return (
    <table className="table">
      <thead><tr>{['', 'Name', 'Email', 'Title', 'Company', 'Source'].map(h => <th key={h} >{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={i}>
            <td ><input type="checkbox" checked={selected.has(i)} onChange={() => onToggle(i)} /></td>
            <td >{c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
            <td >{c.email}</td>
            <td >{c.title || c.role || '—'}</td>
            <td >{c.company || c.website || '—'}</td>
            <td ><span className="chip chip-neutral">{c.source || '—'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function ExistingTable({ rows, selected, onToggle }) {
  return (
    <table className="table">
      <thead><tr>{['', 'Name', 'Email', 'Type', 'Location', 'Company'].map(h => <th key={h} >{h}</th>)}</tr></thead>
      <tbody>
        {rows.map(c => (
          <tr key={c.id}>
            <td ><input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} /></td>
            <td >{c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
            <td >{c.email}</td>
            <td >{c.contact_type || '—'}</td>
            <td >{c.location || '—'}</td>
            <td >{c.company || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Tag({ children, onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-soft)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: '3px 8px 3px 10px', fontSize: 12 }}>
      {children}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 13, lineHeight: 1, padding: 0 }} title="Remove">×</button>
    </span>
  );
}
function AddPill({ onAdd, placeholder }) {
  const [v, setV] = useState('');
  return (
    <input className="input" style={{ marginTop: 8, fontSize: 12, padding: '4px 8px', maxWidth: 220 }}
      value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && v.trim()) { onAdd(v); setV(''); }
      }} />
  );
}
function Summary({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value || '—'}</div>
    </div>
  );
}
function H({ children }) { return <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>{children}</h2>; }
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>{children}</div>;
}
function Footer({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}


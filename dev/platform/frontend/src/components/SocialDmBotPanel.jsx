// Social → Performance → DM bot (phase 1). Configure a per-client Instagram DM
// bot persona, generate on-brand reply templates, and live-test the reply the
// bot would send to any pasted message. The brain + drafts, owned in OMI —
// the live Meta auto-send webhook is a later phase.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

const TONES = ['warm', 'professional', 'playful', 'concise'];
const TRIGGER_LABEL = {
  comment_to_dm: 'Comment → DM', keyword_dm: 'Keyword DM', story_reply: 'Story reply', faq: 'FAQ', other: 'Other',
};

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return <button className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch {} }}>{done ? 'Copied' : 'Copy'}</button>;
}

export default function SocialDmBotPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [persona, setPersona] = useState({ system_prompt: '', faqs: '', tone: 'warm', max_words: 45, escalation: '' });
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [scenario, setScenario] = useState('');
  const [generating, setGenerating] = useState(false);
  const [incoming, setIncoming] = useState('');
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [live, setLive] = useState(null);       // { config, events, webhook_path, verify_token_set }
  const [igId, setIgId] = useState('');
  const [pageToken, setPageToken] = useState('');
  const [keywords, setKeywords] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [publicReply, setPublicReply] = useState(false);
  const [publicReplyText, setPublicReplyText] = useState('');
  const [savingLive, setSavingLive] = useState(false);
  const [links, setLinks] = useState([]);
  const [linkDest, setLinkDest] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [addingLink, setAddingLink] = useState(false);

  async function load() {
    try {
      const [p, t, l, lk] = await Promise.all([
        api.get(`/social/clients/${clientId}/dm-bot/persona`),
        api.get(`/social/clients/${clientId}/dm-bot/templates`),
        api.get(`/social/clients/${clientId}/dm-bot/live`).catch(() => null),
        api.get(`/social/clients/${clientId}/dm-bot/links`).catch(() => ({ links: [] })),
      ]);
      setLinks(lk?.links || []);
      if (p.persona && Object.keys(p.persona).length) setPersona(prev => ({ ...prev, ...p.persona }));
      setSavedAt(p.updated_at || null);
      setTemplates(t.templates || []);
      if (l) {
        setLive(l);
        setIgId(l.config?.ig_user_id || '');
        setKeywords((l.config?.comment_keywords || []).join(', '));
        setPublicReply(!!l.config?.public_reply);
        setPublicReplyText(l.config?.public_reply_text || '');
      }
    } catch (e) { toast(e.message, 'error'); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function saveLive(nextEnabled) {
    setSavingLive(true);
    try {
      const body = {
        enabled: nextEnabled ?? live?.config?.enabled ?? false,
        ig_user_id: igId.trim() || null,
        comment_keywords: keywords.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
        public_reply: publicReply,
        public_reply_text: publicReplyText.trim() || null,
      };
      if (pageToken.trim()) body.page_token = pageToken.trim();
      const config = await api.put(`/social/clients/${clientId}/dm-bot/live`, body);
      setLive(prev => ({ ...(prev || {}), config }));
      setPageToken('');
      toast('Live settings saved.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingLive(false); }
  }

  async function savePersona() {
    setSaving(true);
    try { const p = await api.put(`/social/clients/${clientId}/dm-bot/persona`, { persona }); setSavedAt(p.updated_at); toast('Persona saved.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function generate() {
    setGenerating(true);
    try { const r = await api.post(`/social/clients/${clientId}/dm-bot/templates/generate`, { scenario, count: 6 }); setTemplates(prev => [...r.templates, ...prev]); toast(`Generated ${r.templates.length} templates.`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setGenerating(false); }
  }

  async function removeTemplate(id) {
    try { await api.delete(`/social/clients/${clientId}/dm-bot/templates/${id}`); setTemplates(prev => prev.filter(t => t.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function addLink() {
    if (!linkDest.trim()) return;
    setAddingLink(true);
    try {
      const { link } = await api.post(`/social/clients/${clientId}/dm-bot/links`, { destination: linkDest.trim(), label: linkLabel.trim() || null });
      setLinks(prev => [link, ...prev.filter(l => l.id !== link.id)]);
      setLinkDest(''); setLinkLabel('');
    } catch (e) { toast(e.message, 'error'); }
    finally { setAddingLink(false); }
  }
  async function removeLink(id) {
    try { await api.delete(`/social/clients/${clientId}/dm-bot/links/${id}`); setLinks(prev => prev.filter(l => l.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function runDraft() {
    if (!incoming.trim()) { toast('Paste an incoming message first.', 'error'); return; }
    setDrafting(true); setDraft('');
    try { const r = await api.post(`/social/clients/${clientId}/dm-bot/draft`, { incoming }); setDraft(r.reply); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDrafting(false); }
  }

  const set = (k, v) => setPersona(p => ({ ...p, [k]: v }));

  return (
    <div className="stack-lg">
      <div>
        <div className="caption">DM bot · phase 1</div>
        <div className="h2 mt-2">Instagram auto-reply — the brain & the drafts</div>
        <p className="body mt-2" style={{ maxWidth: 640 }}>
          Configure how the bot speaks for this brand, generate ready reply templates, and test the exact reply it would send.
          This is the persona + replies, owned here — wiring it to live auto-send via Meta is a later phase.
        </p>
      </div>

      {/* Collapsible setup guide — the panel packs a lot in; this makes the
          order of operations and what's stored explicit. */}
      <div className="card">
        <button type="button" onClick={() => setGuideOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="caption">Setup guide</div>
            <div className="h3 mt-1">How to set up the DM bot</div>
          </div>
          <span className="chip chip-neutral">{guideOpen ? 'Hide' : 'Show'}</span>
        </button>
        {guideOpen && (
          <div className="mt-4">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
              <li className="body-sm"><strong>Set the persona.</strong> In <em>Bot persona</em> below, describe the brand's tone, sign-off and the max words per reply. Everything the bot writes follows this.</li>
              <li className="body-sm"><strong>Test a reply.</strong> Paste a message a follower might send in <em>Test a reply</em> — you see the exact response before anything goes live. Tweak the persona until it sounds right.</li>
              <li className="body-sm"><strong>Generate templates.</strong> In <em>Reply templates</em>, generate ready-made replies for common triggers (price, link, FAQ). Copy them, or keep them as the bot's fallbacks.</li>
              <li className="body-sm"><strong>Go live (optional).</strong> In <em>Live auto-send</em>, connect the Instagram account (Meta), set the comment trigger keywords (blank = any comment), and optionally post a public reply too. Until you connect Meta, the bot only drafts — it never sends.</li>
              <li className="body-sm"><strong>Watch activity.</strong> Once live, every incoming message and the reply sent are logged under <em>Recent activity</em> with their status.</li>
            </ol>
            <p className="body-xs text-subtle mt-3">
              <strong>Does it store requests and replies?</strong> Yes — once live auto-send is connected, each inbound message (→) and outbound reply (↩) is recorded in Recent activity. Before that, nothing is sent or stored; the Test panel is throwaway.
            </p>
          </div>
        )}
      </div>

      <div className="dmbot-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
      {/* Left column: persona + live test */}
      <div className="stack-lg">
      {/* Persona */}
      <div className="card">
        <div className="caption mb-2">Bot persona</div>
        <label className="field-label">Brand instructions (system prompt)</label>
        <textarea className="input" style={{ minHeight: 80 }} value={persona.system_prompt} onChange={e => set('system_prompt', e.target.value)}
          placeholder="e.g. You're the friendly front desk for a London dental practice. Answer questions, nudge toward booking a consult." />
        <label className="field-label mt-3">FAQs / facts the bot can use</label>
        <textarea className="input" style={{ minHeight: 90 }} value={persona.faqs} onChange={e => set('faqs', e.target.value)}
          placeholder={'Opening hours: Mon–Fri 9–6\nConsults from £49\nWe\'re near Liverpool St station'} />
        <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div>
            <label className="field-label">Tone</label>
            <select className="input" value={persona.tone} onChange={e => set('tone', e.target.value)}>
              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Max words / reply</label>
            <input className="input" type="number" min={15} max={120} value={persona.max_words} onChange={e => set('max_words', e.target.value)} style={{ width: 120 }} />
          </div>
        </div>
        <label className="field-label mt-3">Escalation rule (when unsure)</label>
        <input className="input" value={persona.escalation} onChange={e => set('escalation', e.target.value)}
          placeholder="e.g. Offer to have the team follow up and ask for their email." />
        <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={savePersona} disabled={saving}>{saving ? 'Saving…' : 'Save persona'}</button>
          {savedAt && <span className="body-xs text-subtle">Saved</span>}
        </div>
      </div>

      {/* Live tester */}
      <div className="card">
        <div className="caption mb-2">Test a reply</div>
        <p className="body-sm text-muted" style={{ marginBottom: 8 }}>Paste a message a follower might send — see exactly what the bot would reply under the persona above.</p>
        <textarea className="input" style={{ minHeight: 60 }} value={incoming} onChange={e => setIncoming(e.target.value)} placeholder="Hey! Do you have any availability this weekend?" />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: runDraft, disabled: drafting })}>{drafting ? 'Drafting…' : 'Draft reply'}</button>
        </div>
        {draft && (
          <div className="card" style={{ marginTop: 10, background: 'var(--surface-raised)' }}>
            <div className="row between center" style={{ marginBottom: 4 }}>
              <div className="caption">Bot would reply</div>
              <CopyBtn text={draft} />
            </div>
            <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{draft}</div>
          </div>
        )}
      </div>
      </div>

      {/* Right column: live auto-send + template library */}
      <div className="stack-lg">
      {/* Go live — Meta auto-send */}
      <div className="card">
        <div className="row between center" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="caption">Live auto-send (Instagram)</div>
          {live?.config && (
            <span style={{ fontSize: 12, fontWeight: 700, color: live.config.enabled ? 'var(--positive, #1a7f37)' : 'var(--text-subtle)' }}>
              {live.config.enabled ? '● Live' : '○ Off'}
            </span>
          )}
        </div>
        <p className="body-sm text-muted" style={{ margin: '6px 0 10px' }}>
          When live, the bot auto-replies to Instagram DMs and comment-to-DM using the persona above — the ManyChat flow, native.
          Connect an Instagram business account and a Page token with <code>instagram_manage_messages</code>.
        </p>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label className="field-label">Instagram business account ID</label>
            <input className="input" value={igId} onChange={e => setIgId(e.target.value)} placeholder="17841400000000000" />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label className="field-label">Page access token {live?.config?.has_token && <span className="text-subtle">(set — leave blank to keep)</span>}</label>
            <input className="input" type="password" value={pageToken} onChange={e => setPageToken(e.target.value)} placeholder={live?.config?.has_token ? '••••••••' : 'EAAG…'} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Comment trigger keywords <span className="text-subtle">(comma-separated — blank = reply to any comment)</span></label>
          <input className="input" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="price, link, info" />
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={publicReply} onChange={e => setPublicReply(e.target.checked)} />
            <span className="body-sm">Also post a public reply under the comment</span>
          </label>
          {publicReply && (
            <input className="input" style={{ marginTop: 6 }} value={publicReplyText} onChange={e => setPublicReplyText(e.target.value)} placeholder="Just sent you a DM 📩" />
          )}
        </div>
        <div className="body-xs text-subtle" style={{ marginTop: 8 }}>
          Anyone who DMs “stop” / “unsubscribe” is auto opted-out and never messaged again.
        </div>
        <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => saveLive()} disabled={savingLive}>{savingLive ? 'Saving…' : 'Save connection'}</button>
          {live?.config && (
            <button
              className={live.config.enabled ? 'btn btn-danger' : 'btn btn-primary'}
              disabled={savingLive || (!live.config.enabled && (!igId.trim() || (!pageToken.trim() && !live.config.has_token)))}
              onClick={() => saveLive(!live.config.enabled)}
            >{live.config.enabled ? 'Turn off' : 'Go live'}</button>
          )}
        </div>
        {live && (
          <div className="body-xs text-subtle" style={{ marginTop: 10, lineHeight: 1.6 }}>
            In the Meta app dashboard, set the webhook callback to <code>{window.location.origin}{live.webhook_path}</code>{' '}
            and subscribe to <strong>messages</strong> + <strong>comments</strong>.{' '}
            {live.verify_token_set ? 'Verify token is configured on the server.' : '⚠ Set META_WEBHOOK_VERIFY_TOKEN on the server to complete verification.'}
          </div>
        )}
        {live?.events?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="caption mb-2">Recent activity</div>
            <div className="stack stack-sm">
              {live.events.slice(0, 12).map(ev => (
                <div key={ev.id} className="body-xs" style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: ev.direction === 'in' ? 'var(--text-muted)' : 'var(--accent)', fontWeight: 700, minWidth: 28 }}>{ev.direction === 'in' ? '→' : '↩'}</span>
                  <span className="text-subtle" style={{ minWidth: 64 }}>{ev.channel}{ev.status ? ` · ${ev.status}` : ''}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tracked links */}
      <div className="card">
        <div className="caption">Tracked links</div>
        <p className="body-sm text-muted" style={{ margin: '6px 0 10px' }}>
          Any link the bot sends in a DM is auto-shortened to a click-tracked redirect — so you see which offers get tapped, not just how many DMs went out. Add one here to paste into a template.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 220px' }}>
            <label className="field-label">Destination URL</label>
            <input className="input" value={linkDest} onChange={e => setLinkDest(e.target.value)} placeholder="https://example.com/offer" onKeyDown={e => { if (e.key === 'Enter') addLink(); }} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label className="field-label">Label <span className="text-subtle">(optional)</span></label>
            <input className="input" value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Spring offer" onKeyDown={e => { if (e.key === 'Enter') addLink(); }} />
          </div>
          <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: addLink, disabled: addingLink || !linkDest.trim() })}>{addingLink ? 'Adding…' : 'Add'}</button>
        </div>
        {links.length > 0 && (
          <div className="stack stack-sm" style={{ marginTop: 12 }}>
            {links.map(l => (
              <div key={l.id} className="card" style={{ padding: '8px 12px' }}>
                <div className="row between center" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="body-sm" style={{ fontWeight: 700 }}>{l.label || l.destination}</div>
                    <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.short_url} → {l.destination}</div>
                  </div>
                  <div className="row center" style={{ gap: 8 }}>
                    <span className="chip chip-neutral" title="Clicks"><strong>{l.clicks}</strong>&nbsp;click{l.clicks === 1 ? '' : 's'}</span>
                    <CopyBtn text={l.short_url} />
                    <button className="btn btn-secondary btn-sm" onClick={() => removeLink(l.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Template library */}
      <div>
        <div className="row between center" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="caption">Reply templates</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ width: 280 }} value={scenario} onChange={e => setScenario(e.target.value)}
              placeholder="Optional focus — e.g. 'pricing questions on Reels'" onKeyDown={e => { if (e.key === 'Enter') generate(); }} />
            <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: generate, disabled: generating })}>{generating ? 'Generating…' : 'Generate'}</button>
          </div>
        </div>
        <div className="stack stack-sm" style={{ marginTop: 10 }}>
          {templates.length === 0 && <div className="body-sm text-subtle">No templates yet — generate a set for the common triggers.</div>}
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding: '10px 14px' }}>
              <div className="row between center" style={{ marginBottom: 4 }}>
                <span className="chip chip-neutral">{TRIGGER_LABEL[t.trigger] || t.trigger}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={t.reply} />
                  <button className="btn btn-secondary btn-sm" onClick={() => removeTemplate(t.id)}>Delete</button>
                </div>
              </div>
              {t.scenario && <div className="body-xs text-subtle" style={{ marginBottom: 4 }}>{t.scenario}</div>}
              <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{t.reply}</div>
            </div>
          ))}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

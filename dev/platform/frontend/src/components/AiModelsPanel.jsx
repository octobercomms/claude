// Settings → AI models. Pick which model runs each text/JSON feature — Claude
// (Fable/Sonnet/Opus) or DeepSeek — so the AM controls cost per task. Cost shows
// as a tier on each option + a tooltip; a 🔒 marks tasks that touch real client
// data, and a ⚠ appears if such a task is routed to DeepSeek. The AI Data
// Analyst has its own per-question picker in the chat, not here.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

export default function AiModelsPanel() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);   // { models, default, features, map }
  const [map, setMap] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/ai-models')
      .then(r => { setCfg(r); setMap(r.map || {}); })
      .catch(e => toast(e.message, 'error'));
    /* eslint-disable-line */
  }, []);

  if (!cfg) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;
  const modelEntries = Object.entries(cfg.models);
  const modelOf = (feat) => map[feat] || cfg.default;

  function setModel(feat, id) {
    setMap(prev => {
      const next = { ...prev };
      if (id === cfg.default) delete next[feat]; else next[feat] = id;
      return next;
    });
  }
  async function save() {
    setSaving(true);
    try { const r = await api.put('/settings/ai-models', { map }); setMap(r.map || {}); toast('AI model routing saved.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        Choose which model runs each task — a cheaper model for simple/bulk jobs, <strong>Opus</strong> for the hard ones, <strong>DeepSeek</strong> for the cheapest. Hover a model for its cost; 🔒 marks tasks that send real client data — DeepSeek sends data to DeepSeek, so a ⚠ shows if you route a 🔒 task there. The <strong>AI Data Analyst</strong> has its own per-question picker in the chat.
      </div>

      {cfg.features.map(group => (
        <div key={group.group} className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="caption" style={{ marginBottom: 'var(--s3)' }}>{group.group}</div>
          <div className="stack stack-sm">
            {group.items.map(it => {
              const sel = modelOf(it.key);
              const spec = cfg.models[sel] || {};
              const warn = it.sensitive && spec.provider === 'deepseek';
              return (
                <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="body-sm" style={{ flex: '1 1 200px', minWidth: 0 }}>
                    {it.label}
                    {it.sensitive && <span title="Sends real client/customer data to the model — keep on Claude for privacy." style={{ marginLeft: 6, cursor: 'help' }}>🔒</span>}
                  </span>
                  <select className="input" style={{ width: 'auto', fontSize: 13, padding: '4px 8px' }}
                    value={sel} onChange={e => setModel(it.key, e.target.value)} title={spec.note || ''}>
                    {modelEntries.map(([id, m]) => <option key={id} value={id}>{m.label} ({m.tier})</option>)}
                  </select>
                  {warn && <span className="chip chip-warning" style={{ fontSize: 10 }} title="This task handles real client data and you've routed it to DeepSeek.">⚠ client data → DeepSeek</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save routing'}</button>
    </div>
  );
}

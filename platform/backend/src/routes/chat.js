const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
router.use(authenticate);

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 6;

function getClaude() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_client_info',
    description: 'Get full client details: all connectors with their status, config, last sync, errors. Use this to understand what data sources are available and whether any have issues.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_connector_data',
    description: 'Fetch live data from a specific connector. Use this to investigate performance, check metrics, answer questions about a specific channel. Fetches the most recent available data.',
    input_schema: {
      type: 'object',
      properties: {
        connector_type: { type: 'string', description: 'e.g. ga4, google_ads, shopify, meta_ads, google_search_console, woocommerce, klaviyo, brevo' },
        days: { type: 'number', description: 'Number of days to fetch (default 30, max 90)' },
        store_label: { type: 'string', description: 'For multi-store clients (e.g. DTC, B2B). Omit to use first matching connector.' },
      },
      required: ['connector_type'],
    },
  },
  {
    name: 'get_seo_rankings',
    description: 'Get current SEO keyword rankings with position history (current, 7d ago, 30d ago, best ever). Shows improvements, declines, and top performers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_reports',
    description: 'List recent reports with status, period, generated/sent timestamps, and any errors.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max reports to return, default 10' },
      },
    },
  },
  {
    name: 'detect_anomalies',
    description: 'Compare this week\'s metrics vs last week across all connected sources. Flags significant changes: revenue drops, traffic spikes/drops, spend changes, ROAS shifts, connector errors.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_context_log',
    description: 'Read the persistent decisions and investigations log — confirmed decisions, open investigations, pending connections, standing observations.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'Filter by status, default open' },
      },
    },
  },
  {
    name: 'add_context_entry',
    description: 'Add an entry to the context log. Use this to track: confirmed decisions (e.g. "exclude brand terms from GSC"), open investigations (e.g. "sessions dropped 40% w/c 5 May — investigating"), pending connections, or standing observations.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'investigation', 'pending', 'observation'] },
        content: { type: 'string', description: 'Clear, specific description of the entry' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'resolve_context_entry',
    description: 'Mark a context log entry as resolved — use when an investigation is closed or a pending item is done.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The entry UUID to resolve' },
      },
      required: ['id'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────

async function toolGetClientInfo(clientId) {
  const [clientRes, connRes] = await Promise.all([
    pool.query('SELECT id, name, domain, monthly_focus, report_recipients, report_schedule FROM clients WHERE id = $1', [clientId]),
    pool.query('SELECT connector_type, store_label, status, last_checked, error_message, config FROM connectors WHERE client_id = $1 ORDER BY connector_type', [clientId]),
  ]);
  const client = clientRes.rows[0];
  return {
    name: client.name,
    domain: client.domain,
    monthly_focus: client.monthly_focus,
    report_recipients: client.report_recipients,
    report_schedule: client.report_schedule,
    connectors: connRes.rows.map(c => ({
      type: c.connector_type,
      store_label: c.store_label,
      status: c.status,
      last_checked: c.last_checked,
      error: c.error_message || null,
      config_keys: c.config ? Object.keys(c.config) : [],
    })),
  };
}

async function toolGetConnectorData(clientId, { connector_type, days = 30, store_label }) {
  const daysNum = Math.min(Number(days) || 30, 90);
  const whereClause = store_label
    ? 'client_id = $1 AND connector_type = $2 AND store_label = $3 AND status = \'active\''
    : 'client_id = $1 AND connector_type = $2 AND status = \'active\'';
  const params = store_label ? [clientId, connector_type, store_label] : [clientId, connector_type];

  const connRes = await pool.query(`SELECT * FROM connectors WHERE ${whereClause} LIMIT 1`, params);
  if (!connRes.rows.length) return { error: `No active ${connector_type} connector found${store_label ? ` with store_label "${store_label}"` : ''}` };

  const connector = connRes.rows[0];
  let creds;
  try { creds = decrypt(connector.credentials); } catch { return { error: 'Failed to decrypt credentials' }; }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd - daysNum * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  const config = connector.config || {};
  try {
    const connModule = connectorFactory.get(connector_type);
    const raw = await connModule.fetchData(creds, {
      ...config,
      periodStart: fmt(periodStart),
      periodEnd: fmt(periodEnd),
    });
    return summariseConnectorData(connector_type, raw, daysNum);
  } catch (err) {
    return { error: err.message };
  }
}

function summariseConnectorData(type, raw, days) {
  if (!raw) return { note: 'No data returned' };
  try {
    if (type === 'ga4') {
      const metHeaders = (raw.metricHeaders || []).map(h => h.name);
      const dimHeaders = (raw.dimensionHeaders || []).map(h => h.name);
      const drIdx = dimHeaders.indexOf('dateRange');
      const chIdx = dimHeaders.indexOf('sessionDefaultChannelGroup');
      const sessIdx = metHeaders.indexOf('sessions');
      const usersIdx = metHeaders.indexOf('activeUsers');
      const convIdx = metHeaders.indexOf('conversions');
      let sessions = 0, users = 0, convs = 0;
      const channels = {};
      for (const row of (raw.rows || [])) {
        if (drIdx >= 0 && row.dimensionValues?.[drIdx]?.value !== 'date_range_0') continue;
        sessions += parseFloat(row.metricValues?.[sessIdx]?.value || 0);
        users += parseFloat(row.metricValues?.[usersIdx]?.value || 0);
        convs += parseFloat(row.metricValues?.[convIdx]?.value || 0);
        const ch = chIdx >= 0 ? row.dimensionValues?.[chIdx]?.value : null;
        if (ch) channels[ch] = (channels[ch] || 0) + parseFloat(row.metricValues?.[sessIdx]?.value || 0);
      }
      const topChannels = Object.entries(channels).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ch, s]) => ({ channel: ch, sessions: Math.round(s) }));
      return { period_days: days, sessions: Math.round(sessions), users: Math.round(users), conversions: Math.round(convs), top_channels: topChannels };
    }
    if (type === 'google_search_console') {
      const rows = raw.rows || [];
      const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
      const imps = rows.reduce((s, r) => s + (r.impressions || 0), 0);
      const avgPos = rows.length ? rows.reduce((s, r) => s + (r.position || 0), 0) / rows.length : null;
      const top = rows.sort((a, b) => b.clicks - a.clicks).slice(0, 10).map(r => ({ query: r.keys?.[0], clicks: r.clicks, position: r.position?.toFixed(1) }));
      return { period_days: days, total_clicks: clicks, total_impressions: imps, avg_position: avgPos?.toFixed(1), top_queries: top };
    }
    if (type === 'google_ads') {
      const batches = Array.isArray(raw) ? raw : [raw];
      let spend = 0, clicks = 0, convs = 0;
      const campaigns = {};
      for (const b of batches) for (const r of (b.results || [])) {
        const s = parseInt(r.metrics?.costMicros || 0) / 1e6;
        spend += s;
        clicks += parseInt(r.metrics?.clicks || 0);
        convs += parseFloat(r.metrics?.conversions || 0);
        const name = r.campaign?.name;
        if (name) campaigns[name] = (campaigns[name] || 0) + s;
      }
      const topCampaigns = Object.entries(campaigns).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, s]) => ({ campaign: name, spend: `£${s.toFixed(2)}` }));
      return { period_days: days, total_spend: `£${spend.toFixed(2)}`, clicks, conversions: convs.toFixed(1), top_campaigns: topCampaigns };
    }
    if (type === 'meta_ads') {
      const data = raw.data || [];
      const spend = data.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
      const imps = data.reduce((s, r) => s + parseInt(r.impressions || 0), 0);
      const clicks = data.reduce((s, r) => s + parseInt(r.clicks || 0), 0);
      const top = data.sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend)).slice(0, 6).map(r => ({ campaign: r.campaign_name, spend: `£${parseFloat(r.spend).toFixed(2)}` }));
      return { period_days: days, total_spend: `£${spend.toFixed(2)}`, impressions: imps, clicks, top_campaigns: top };
    }
    if (type === 'shopify' || type === 'woocommerce') {
      const s = raw.summary || {};
      return { period_days: days, revenue: `£${parseFloat(s.total_revenue || 0).toFixed(2)}`, orders: s.total_orders, aov: `£${parseFloat(s.avg_order_value || 0).toFixed(2)}` };
    }
    if (type === 'klaviyo' || type === 'brevo') {
      return { period_days: days, total_campaigns: raw.total_campaigns, aggregated_stats: raw.aggregated_stats };
    }
    return { period_days: days, raw_keys: Object.keys(raw) };
  } catch (e) {
    return { period_days: days, parse_error: e.message, raw_type: typeof raw };
  }
}

async function toolGetSeoRankings(clientId) {
  const { rows } = await pool.query(
    `SELECT k.keyword, k.tag, k.location_name,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS current_position,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id AND checked_at <= CURRENT_DATE - 7 ORDER BY checked_at DESC LIMIT 1) AS position_7d_ago,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id AND checked_at <= CURRENT_DATE - 30 ORDER BY checked_at DESC LIMIT 1) AS position_30d_ago,
       (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id) AS best_position
     FROM seo_keywords k WHERE k.client_id = $1 AND k.active = true
     ORDER BY current_position ASC NULLS LAST`,
    [clientId]
  );
  const ranked = rows.filter(r => r.current_position);
  const top10 = ranked.slice(0, 10);
  const improved = ranked.filter(r => r.position_30d_ago && r.current_position < r.position_30d_ago)
    .sort((a, b) => (b.position_30d_ago - b.current_position) - (a.position_30d_ago - a.current_position)).slice(0, 5);
  const declined = ranked.filter(r => r.position_30d_ago && r.current_position > r.position_30d_ago)
    .sort((a, b) => (b.current_position - b.position_30d_ago) - (a.current_position - a.position_30d_ago)).slice(0, 5);
  return {
    total_tracked: rows.length,
    ranking: ranked.length,
    top_10: ranked.filter(r => r.current_position <= 10).length,
    top_3: ranked.filter(r => r.current_position <= 3).length,
    top_keywords: top10.map(r => ({ keyword: r.keyword, position: r.current_position, tag: r.tag })),
    most_improved_30d: improved.map(r => ({ keyword: r.keyword, now: r.current_position, was: r.position_30d_ago, change: r.position_30d_ago - r.current_position })),
    most_declined_30d: declined.map(r => ({ keyword: r.keyword, now: r.current_position, was: r.position_30d_ago, change: r.current_position - r.position_30d_ago })),
  };
}

async function toolGetReports(clientId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT report_type, period_start, period_end, status, generated_at, sent_at, error_log
     FROM reports WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientId, Math.min(limit, 25)]
  );
  return rows.map(r => ({
    type: r.report_type,
    period: `${r.period_start?.toISOString().split('T')[0]} – ${r.period_end?.toISOString().split('T')[0]}`,
    status: r.status,
    generated_at: r.generated_at,
    sent_at: r.sent_at,
    error: r.error_log || null,
  }));
}

async function toolDetectAnomalies(clientId) {
  const connRes = await pool.query(
    `SELECT * FROM connectors WHERE client_id = $1 AND status = 'active'`,
    [clientId]
  );
  const anomalies = [];
  const now = new Date();
  const thisStart = new Date(now - 7 * 86400000);
  const prevStart = new Date(now - 14 * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  for (const connector of connRes.rows) {
    let creds;
    try { creds = decrypt(connector.credentials); } catch { continue; }
    const config = connector.config || {};
    try {
      const connModule = connectorFactory.get(connector.connector_type);
      const [curr, prev] = await Promise.all([
        connModule.fetchData(creds, { ...config, periodStart: fmt(thisStart), periodEnd: fmt(now) }),
        connModule.fetchData(creds, { ...config, periodStart: fmt(prevStart), periodEnd: fmt(thisStart) }),
      ]);
      const currSummary = summariseConnectorData(connector.connector_type, curr, 7);
      const prevSummary = summariseConnectorData(connector.connector_type, prev, 7);
      const label = connector.store_label ? `${connector.connector_type} (${connector.store_label})` : connector.connector_type;
      checkMetricAnomaly(anomalies, label, 'sessions', currSummary.sessions, prevSummary.sessions, 25);
      checkMetricAnomaly(anomalies, label, 'total_clicks', currSummary.total_clicks, prevSummary.total_clicks, 30);
      checkMetricAnomaly(anomalies, label, 'revenue', currSummary.revenue, prevSummary.revenue, 20, true);
      checkMetricAnomaly(anomalies, label, 'total_spend', currSummary.total_spend, prevSummary.total_spend, 40, true);
    } catch { /* connector might not support this period */ }
  }

  // Flag errored connectors
  const errored = await pool.query(
    `SELECT connector_type, store_label, error_message FROM connectors WHERE client_id = $1 AND status IN ('error','expired','disconnected')`,
    [clientId]
  );
  for (const c of errored.rows) {
    anomalies.push({ source: c.connector_type, type: 'connector_error', severity: 'high', message: `${c.connector_type}${c.store_label ? ` (${c.store_label})` : ''} is ${c.status}: ${c.error_message || 'no detail'}` });
  }

  return { anomalies, checked_at: new Date().toISOString(), total_flagged: anomalies.length };
}

function checkMetricAnomaly(anomalies, source, metric, curr, prev, thresholdPct, isCurrencyStr = false) {
  if (curr == null || prev == null) return;
  const parseVal = v => typeof v === 'string' ? parseFloat(v.replace(/[^0-9.-]/g, '')) : v;
  const c = parseVal(curr), p = parseVal(prev);
  if (!p || !c) return;
  const changePct = ((c - p) / p) * 100;
  if (Math.abs(changePct) >= thresholdPct) {
    anomalies.push({
      source,
      metric,
      current: curr,
      previous: prev,
      change_pct: changePct.toFixed(1),
      direction: changePct > 0 ? 'up' : 'down',
      severity: Math.abs(changePct) >= thresholdPct * 2 ? 'high' : 'medium',
    });
  }
}

async function toolGetContextLog(clientId, status = 'open') {
  const whereStatus = status === 'all' ? '' : `AND status = '${status === 'resolved' ? 'resolved' : 'open'}'`;
  const { rows } = await pool.query(
    `SELECT id, type, content, status, created_at, resolved_at
     FROM client_context_log WHERE client_id = $1 ${whereStatus} ORDER BY created_at DESC`,
    [clientId]
  );
  return rows;
}

async function toolAddContextEntry(clientId, { type, content }) {
  const { rows } = await pool.query(
    `INSERT INTO client_context_log (client_id, type, content) VALUES ($1, $2, $3) RETURNING id, type, content, status, created_at`,
    [clientId, type, content]
  );
  return { success: true, entry: rows[0] };
}

async function toolResolveContextEntry(entryId) {
  const { rows } = await pool.query(
    `UPDATE client_context_log SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING id, type, content`,
    [entryId]
  );
  if (!rows.length) return { error: 'Entry not found' };
  return { success: true, resolved: rows[0] };
}

async function executeTool(name, input, clientId) {
  switch (name) {
    case 'get_client_info':       return toolGetClientInfo(clientId);
    case 'get_connector_data':    return toolGetConnectorData(clientId, input);
    case 'get_seo_rankings':      return toolGetSeoRankings(clientId);
    case 'get_reports':           return toolGetReports(clientId, input.limit);
    case 'detect_anomalies':      return toolDetectAnomalies(clientId);
    case 'get_context_log':       return toolGetContextLog(clientId, input.status);
    case 'add_context_entry':     return toolAddContextEntry(clientId, input);
    case 'resolve_context_entry': return toolResolveContextEntry(input.id);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(client, connectors) {
  const connectorList = connectors.length
    ? connectors.map(c => `${c.connector_type}${c.store_label ? ` (${c.store_label})` : ''} [${c.status}]`).join(', ')
    : 'none configured';

  return `You are a performance marketing analyst working directly with October Communications on the ${client.name} account.

You have tools to read live data, check SEO rankings, view reports, detect anomalies, and maintain a persistent context log. Use them proactively — don't wait to be asked to check data if it would make your answer more useful.

Your responsibilities:
1. Investigate performance questions by pulling actual data, not estimating
2. Flag anomalies — significant metric changes, connector errors, unusual patterns
3. Help decide which sections and metrics belong in their reports
4. Maintain the context log: add decisions, open investigations, pending items; close them when resolved
5. Suggest angles the account manager might not have considered
6. Give concrete, specific advice grounded in the actual data you've pulled

Connected data sources: ${connectorList}

Client: ${client.name} | Domain: ${client.domain || 'not set'} | Monthly focus: ${client.monthly_focus || 'not set'}

British English. Commercially minded. When you use tools, briefly mention what you checked so the account manager can see your reasoning.`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, content, tools_used, created_at
       FROM client_chat_messages WHERE client_id = $1
       ORDER BY created_at ASC LIMIT 200`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:clientId', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  const clientId = req.params.clientId;
  try {
    const [clientRes, connectorsRes, historyRes] = await Promise.all([
      pool.query('SELECT * FROM clients WHERE id = $1', [clientId]),
      pool.query('SELECT connector_type, store_label, status FROM connectors WHERE client_id = $1', [clientId]),
      pool.query(
        `SELECT role, content FROM client_chat_messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 40`,
        [clientId]
      ),
    ]);

    if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];
    const history = historyRes.rows.reverse();

    await pool.query(
      'INSERT INTO client_chat_messages (client_id, role, content) VALUES ($1, $2, $3)',
      [clientId, 'user', message.trim()]
    );

    // Agentic loop with tool use
    let messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];
    const toolsUsed = [];
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await getClaude().messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: buildSystemPrompt(client, connectorsRes.rows),
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'end_turn') {
        finalText = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            let result;
            try {
              result = await executeTool(block.name, block.input, clientId);
            } catch (err) {
              result = { error: err.message };
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        // Unexpected stop reason — grab any text and exit
        finalText = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }
    }

    if (!finalText) finalText = 'I wasn\'t able to complete that. Please try again.';

    const { rows } = await pool.query(
      `INSERT INTO client_chat_messages (client_id, role, content, tools_used)
       VALUES ($1, 'assistant', $2, $3) RETURNING id, role, content, tools_used, created_at`,
      [clientId, finalText, JSON.stringify(toolsUsed)]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:clientId', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_chat_messages WHERE client_id = $1', [req.params.clientId]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Context log endpoints
router.get('/:clientId/context', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, content, status, created_at, resolved_at
       FROM client_context_log WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:clientId/context/:entryId', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_context_log WHERE id = $1 AND client_id = $2', [req.params.entryId, req.params.clientId]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

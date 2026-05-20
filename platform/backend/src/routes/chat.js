const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
router.use(authenticate);

const MODEL = 'claude-sonnet-4-6';

function getClaude() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

function buildSystemPrompt(client, connectors) {
  const connectorList = connectors.length
    ? connectors.map(c => c.store_label ? `${c.connector_type} (${c.store_label})` : c.connector_type).join(', ')
    : 'none configured';

  return `You are a performance marketing analyst working directly with October Communications on the ${client.name} account. Your job is to help build bespoke, genuinely useful reports — not generic ones.

You have access to live data from these connected sources: ${connectorList}.

Your responsibilities:
1. Understand what matters to this client's business right now
2. Help decide which sections and metrics belong in their reports
3. Proactively suggest angles they might not have considered — based on what connectors are active and what's typical for businesses like theirs
4. Track ongoing investigations (e.g. "why did sessions drop in March?") and suggest removing them from reports once resolved
5. Give concrete, specific advice — not generic marketing platitudes

When the user asks to add or remove something from their reports, confirm it clearly. When you suggest something new, explain the business reason.

Current client context:
- Name: ${client.name}
- Domain: ${client.domain || 'not set'}
- Monthly focus: ${client.monthly_focus || 'not set'}
- Data sources: ${connectorList}

British English. Be direct and commercially minded.`;
}

// GET /chat/:clientId — message history
router.get('/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, content, created_at
       FROM client_chat_messages
       WHERE client_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /chat/:clientId — send message
router.post('/:clientId', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  try {
    const clientRes = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    const connectorsRes = await pool.query(
      `SELECT connector_type, store_label, status FROM connectors WHERE client_id = $1 AND status = 'active'`,
      [req.params.clientId]
    );

    // Fetch recent history for context (last 40 messages)
    const historyRes = await pool.query(
      `SELECT role, content FROM client_chat_messages
       WHERE client_id = $1
       ORDER BY created_at DESC LIMIT 40`,
      [req.params.clientId]
    );
    const history = historyRes.rows.reverse();

    // Store user message
    await pool.query(
      'INSERT INTO client_chat_messages (client_id, role, content) VALUES ($1, $2, $3)',
      [req.params.clientId, 'user', message.trim()]
    );

    // Build messages array for Claude
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    const response = await getClaude().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(client, connectorsRes.rows),
      messages,
    });

    const assistantContent = response.content[0].text;

    // Store assistant response
    const { rows } = await pool.query(
      `INSERT INTO client_chat_messages (client_id, role, content)
       VALUES ($1, 'assistant', $2) RETURNING id, role, content, created_at`,
      [req.params.clientId, assistantContent]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /chat/:clientId — clear history
router.delete('/:clientId', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_chat_messages WHERE client_id = $1', [req.params.clientId]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

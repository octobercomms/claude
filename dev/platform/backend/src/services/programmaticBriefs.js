// Programmatic page builder — Pipeline → Brief → "From a spreadsheet" mode.
//
// AM uploads a CSV (e.g. service, location, price) + a template prompt
// with placeholders ("Local services landing page for {service} in
// {location}"). We iterate rows, substitute placeholders, ask Claude
// for a brief per row, persist everything.
//
// One Claude call per row (~$0.015 with Sonnet 4.6). The AM can review
// the batch and promote any brief into Pipeline → Draft.

const pool = require('../db');
const claudeService = require('./claude');
const brandVoice = require('./brandVoice');

const MODEL = 'claude-sonnet-4-6';
const CLAUDE_COST_PER_BRIEF_USD = 0.015;
const MAX_ROWS_PER_RUN = 200;

// Tight CSV parser — supports quoted fields with embedded commas + escaped
// quotes ("" → "). Doesn't try to be a full RFC 4180 implementation; just
// handles the shapes AMs realistically paste.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else { cell += ch; }
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Drop trailing empty rows + empty cells in fully-blank rows.
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const headers = rows[0].map(h => h.trim()).filter(Boolean);
  if (!headers.length) throw new Error('CSV header row is empty');
  return {
    headers,
    rows: rows.slice(1).map(r => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = (r[i] || '').trim();
      return obj;
    }).filter(o => Object.values(o).some(v => v)),
  };
}

// {placeholder} → value from rowData. Missing keys leave the literal
// placeholder so the AM can spot template/CSV mismatches in the output
// rather than silently rendering nothing.
function fillTemplate(template, rowData) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => {
    const v = rowData[key.trim()];
    return v == null ? `{${key}}` : String(v);
  });
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

const BRIEF_SYSTEM = `You are an SEO content strategist generating a programmatic landing-page brief. British English. Tight, commercial, no filler. Output JSON only — no prose, no markdown fences.

The page is one of many in a programmatic set, but each row should still feel like a real page — not a Mad Libs fill-in. Lead with the user intent for this specific combination of inputs.`;

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  return rows[0];
}

async function generateOneBrief({ client, voiceContext, templatePrompt, rowData, primaryKeyword }) {
  const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing)'}
Domain: ${client.domain || '(no domain)'}${voiceContext}

This page is part of a programmatic set. The template the AM defined:
"${templatePrompt}"

This specific row of data (use these values to drive the brief):
${Object.entries(rowData).map(([k, v]) => `${k}: ${v}`).join('\n')}

Primary keyword for this page: "${primaryKeyword}"

Generate a content brief for this specific combination. Return a JSON object with the keys:
- title: working title (≤ 70 chars, includes primary keyword)
- slug: URL slug, lowercase hyphenated, ≤ 60 chars
- target_intent: "informational" | "commercial" | "transactional"
- summary: 1-2 sentence pitch
- outline: 4-7 section objects { heading, points: [3-5 bullet strings] }
- questions_to_answer: array of 3-5 specific questions
- suggested_word_count: integer
- meta_title: < 60 chars, includes primary keyword
- meta_description: < 155 chars

Return ONLY the JSON object.`;

  const raw = await claudeService.callClaude({
    model: MODEL,
    max_tokens: 2000,
    system: BRIEF_SYSTEM,
    user: userPrompt,
  });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function runProgrammaticBatch({ clientId, name, templatePrompt, primaryKeywordTemplate, csvText }) {
  if (!templatePrompt) throw new Error('templatePrompt required');
  if (!primaryKeywordTemplate) throw new Error('primaryKeywordTemplate required');

  const { headers, rows } = csvToObjects(csvText);
  if (rows.length > MAX_ROWS_PER_RUN) {
    throw new Error(`Max ${MAX_ROWS_PER_RUN} rows per run (got ${rows.length}). Split into multiple runs.`);
  }

  const estCost = +(rows.length * CLAUDE_COST_PER_BRIEF_USD).toFixed(4);

  const { rows: runRows } = await pool.query(
    `INSERT INTO programmatic_runs
     (client_id, name, template_prompt, csv_headers, total_rows, status, estimated_cost_usd, claude_model)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7) RETURNING *`,
    [clientId, name || 'Programmatic batch', templatePrompt, JSON.stringify(headers), rows.length, estCost, MODEL]
  );
  const run = runRows[0];

  // Persist row stubs up front so the UI can show progress.
  for (let i = 0; i < rows.length; i++) {
    await pool.query(
      `INSERT INTO programmatic_briefs (run_id, client_id, row_index, row_data, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [run.id, clientId, i, JSON.stringify(rows[i])]
    );
  }

  // Generate sequentially to keep Claude rate-limit headroom; with
  // 200 max rows × ~2s per call this is < 7 mins worst case.
  const client = await loadClient(clientId);
  const voiceProfile = await brandVoice.loadActiveProfile(clientId);
  const voiceContext = brandVoice.renderForPrompt(voiceProfile);

  let completed = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i];
    const primaryKeyword = fillTemplate(primaryKeywordTemplate, rowData);
    await pool.query(`UPDATE programmatic_briefs SET status = 'generating', updated_at = NOW() WHERE run_id = $1 AND row_index = $2`, [run.id, i]);
    try {
      const brief = await generateOneBrief({ client, voiceContext, templatePrompt, rowData, primaryKeyword });
      const title = brief.title || fillTemplate(templatePrompt, rowData).slice(0, 70);
      const slug = brief.slug || slugify(title);
      await pool.query(
        `UPDATE programmatic_briefs SET
           status = 'complete',
           title = $1, slug = $2, primary_keyword = $3, brief_json = $4,
           updated_at = NOW()
         WHERE run_id = $5 AND row_index = $6`,
        [title, slug, primaryKeyword, JSON.stringify(brief), run.id, i]
      );
      completed++;
    } catch (err) {
      await pool.query(
        `UPDATE programmatic_briefs SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE run_id = $2 AND row_index = $3`,
        [err.message, run.id, i]
      );
      failed++;
    }
    // Update run progress so the UI sees a moving counter.
    await pool.query(
      `UPDATE programmatic_runs SET completed_rows = $1, failed_rows = $2 WHERE id = $3`,
      [completed, failed, run.id]
    );
  }

  await pool.query(
    `UPDATE programmatic_runs SET status = 'complete', completed_at = NOW() WHERE id = $1`,
    [run.id]
  );
  return { run_id: run.id, total: rows.length, completed, failed };
}

// Promote a single programmatic brief into Pipeline → Draft by creating
// a content_drafts row from its brief_json. The AM can then run the
// existing Draft step to turn it into a full post.
async function promoteToDraft({ briefId }) {
  const { rows } = await pool.query('SELECT * FROM programmatic_briefs WHERE id = $1', [briefId]);
  if (!rows.length) throw new Error('Brief not found');
  const pb = rows[0];
  if (pb.status !== 'complete' || !pb.brief_json) throw new Error('Brief is not complete yet');
  if (pb.content_draft_id) {
    const existing = await pool.query('SELECT * FROM content_drafts WHERE id = $1', [pb.content_draft_id]);
    if (existing.rows.length) return existing.rows[0];
  }
  // Insert a content_drafts row in 'draft' status. body_markdown / html
  // stay empty — the AM will run the Draft step next to fill them in.
  const { rows: drafts } = await pool.query(
    `INSERT INTO content_drafts
     (client_id, target_keyword, brief_json, title, meta_description, body_markdown, body_html, word_count, claude_model)
     VALUES ($1, $2, $3, $4, $5, '', '', 0, $6) RETURNING *`,
    [pb.client_id, pb.primary_keyword, pb.brief_json, pb.title || 'Untitled', pb.brief_json?.meta_description || null, MODEL]
  );
  const draft = drafts[0];
  await pool.query('UPDATE programmatic_briefs SET content_draft_id = $1, updated_at = NOW() WHERE id = $2', [draft.id, pb.id]);
  return draft;
}

module.exports = { runProgrammaticBatch, promoteToDraft, csvToObjects, fillTemplate };

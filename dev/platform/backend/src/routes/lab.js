/**
 * The checker bench — temporary, and labelled temporary everywhere.
 *
 * It exists to answer one question: does October's deterministic checker
 * predict anything a trained detector agrees with, on October's own writing?
 * Load specimens, label how each was really produced, score them with both
 * tools, look at the two columns side by side.
 *
 * When the thresholds are set, this route, its page and its table go. That is
 * why none of it touches pr_press_releases.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const humanity = require('../services/humanity');
const pangram = require('../services/pangram');
const budget = require('../services/budget');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');

router.use(authenticate, requireAdmin);

const LABELS = ['cold', 'ai_rewritten', 'ai_edited', 'ai_raw', 'unknown'];

// Bumped whenever the analyser's scoring changes, so a table holding scores
// from two different vintages is visible rather than silently mixed.
const ANALYSER_VERSION = '2026-10-12';

function clean(row) {
  return {
    ...row,
    pangram_pct: row.pangram_pct == null ? null : Number(row.pangram_pct),
    pangram_cost_usd: row.pangram_cost_usd == null ? null : Number(row.pangram_cost_usd),
  };
}

/** Every specimen, newest first, without the bodies. */
router.get('/samples', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, title, label, word_count, note, own_score, own_scored_at, own_version,
            pangram_pct, pangram_checked_at, pangram_cost_usd, created_at
       FROM checker_samples ORDER BY created_at DESC`
  );
  const configured = await pangram.configured();
  res.json({ samples: rows.map(clean), pangram_configured: configured, analyser_version: ANALYSER_VERSION });
});

router.get('/samples/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM checker_samples WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(clean(rows[0]));
});

/** Add a specimen, scoring it with our own analyser immediately. That is free. */
router.post('/samples', async (req, res) => {
  const { title = '', label = 'unknown', body_html = '', note = '' } = req.body || {};
  if (!String(body_html).trim()) return res.status(400).json({ error: 'Paste the release text.' });
  if (!LABELS.includes(label)) return res.status(400).json({ error: `label must be one of ${LABELS.join(', ')}` });

  const reading = await humanity.analyse(body_html, {}, {});
  const words = pangram.wordCount(reading ? String(body_html).replace(/<[^>]+>/g, ' ') : body_html);
  const { rows } = await db.query(
    `INSERT INTO checker_samples (title, label, body_html, note, word_count,
                                  own_score, own_json, own_scored_at, own_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8) RETURNING *`,
    [String(title).slice(0, 300), label, body_html, String(note).slice(0, 1000), words,
      reading?.human_score ?? null, reading ? JSON.stringify(reading) : null, ANALYSER_VERSION]
  );
  res.json(clean(rows[0]));
});

router.patch('/samples/:id', async (req, res) => {
  const { label, note, title } = req.body || {};
  if (label && !LABELS.includes(label)) return res.status(400).json({ error: 'bad label' });
  const sets = [];
  const vals = [];
  for (const [col, val] of [['label', label], ['note', note], ['title', title]]) {
    if (val !== undefined) { vals.push(val); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE checker_samples SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(clean(rows[0]));
});

router.delete('/samples/:id', async (req, res) => {
  await db.query('DELETE FROM checker_samples WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

/**
 * Re-score the whole corpus with the current analyser.
 *
 * This is the loop the bench exists for: change a weight, push, press this, and
 * see whether agreement with the detector improved across every specimen at
 * once rather than on the one release in front of you. Costs nothing, because
 * our own checker never bills.
 */
router.post('/rescore', async (req, res) => {
  const { rows } = await db.query('SELECT id, body_html FROM checker_samples');
  let done = 0;
  for (const row of rows) {
    const reading = await humanity.analyse(row.body_html, {}, {});
    if (!reading) continue;
    await db.query(
      `UPDATE checker_samples
          SET own_score = $1, own_json = $2, own_scored_at = NOW(), own_version = $3, updated_at = NOW()
        WHERE id = $4`,
      [reading.human_score, JSON.stringify(reading), ANALYSER_VERSION, row.id]
    );
    done += 1;
  }
  res.json({ rescored: done, analyser_version: ANALYSER_VERSION });
});

/** What a detector run over the unchecked specimens would cost, before pressing go. */
router.get('/detector-quote', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, title, body_html FROM checker_samples WHERE pangram_checked_at IS NULL'
  );
  const items = rows.map((r) => ({
    id: r.id, title: r.title,
    words: pangram.wordCount(String(r.body_html).replace(/<[^>]+>/g, ' ')),
    cost_usd: pangram.estimateUsd(String(r.body_html).replace(/<[^>]+>/g, ' ')),
  }));
  res.json({
    pending: items.length,
    words: items.reduce((n, i) => n + i.words, 0),
    cost_usd: +items.reduce((n, i) => n + i.cost_usd, 0).toFixed(2),
    configured: await pangram.configured(),
    budget: await budget.getTaskBudget('detector_check').catch(() => null),
  });
});

/**
 * Run the detector over ONE specimen. One row per press.
 *
 * Deliberately not a bulk endpoint. A loop over thirty specimens is thirty
 * billable calls behind a single click, and the standing instruction on this
 * platform is that it never hits go on anything by itself.
 */
router.post('/samples/:id/detect', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM checker_samples WHERE id = $1', [req.params.id]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  const text = String(row.body_html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Already checked, and the text has not moved since: serve the stored result
  // rather than paying for the same answer twice.
  if (row.pangram_checked_at && row.pangram_json?.fingerprint === pangram.fingerprint(text)) {
    return res.json({ ...clean(row), cached: true });
  }

  try {
    const result = await pangram.detect(text);
    const stored = { ...result.raw, fingerprint: pangram.fingerprint(text), words: result.words };
    const upd = await db.query(
      `UPDATE checker_samples
          SET pangram_pct = $1, pangram_json = $2, pangram_checked_at = NOW(),
              pangram_cost_usd = $3, updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [result.pct, JSON.stringify(stored), result.cost_usd, row.id]
    );
    res.json({ ...clean(upd.rows[0]), cached: false });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * The corpus as CSV.
 *
 * This is how the data reaches a calibration session: the pairs live in
 * production Postgres, which no development session reaches, so the operator
 * downloads this and commits it. One extra step, twice a year, in exchange for
 * not handing a session the production database.
 */
router.get('/export.csv', async (req, res) => {
  const { rows } = await db.query(
    `SELECT title, label, word_count, own_score, own_version, pangram_pct,
            pangram_checked_at, note,
            own_json->>'density' AS density,
            own_json->>'bare_pct' AS bare_pct,
            jsonb_array_length(COALESCE(own_json->'tells', '[]'::jsonb)) AS tells,
            own_json->>'named_quotes' AS named_quotes
       FROM checker_samples ORDER BY created_at`
  );
  const cols = ['title', 'label', 'word_count', 'own_score', 'own_version', 'pangram_pct',
    'pangram_checked_at', 'density', 'bare_pct', 'tells', 'named_quotes', 'note'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="checker-bench.csv"');
  res.send(csv);
});

module.exports = router;

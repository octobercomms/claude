/**
 * A batch: one template, many items, one review sheet.
 *
 * This is the thing Daniel asked for — "upload images to projects and brief
 * it, and then set it to run, and then move to the next project" — and the
 * whole of its value is that nobody watches it. Everything here follows from
 * that one fact.
 *
 * **Per-item failure must not fail the batch.** A missing photograph on item
 * nineteen is item nineteen's problem. The old stills path passed provider
 * errors straight through, which for one video is correct and for thirty is
 * the difference between twenty-nine videos and none.
 *
 * **Nothing is silently dropped.** An item that cannot run is still a row on
 * the sheet, carrying the pre-flight's own words about what it needs, because
 * an operator who submitted thirty and got twenty-six has to be able to see
 * which four and why. That is why `composition_batch_items` exists rather
 * than a `batch_id` on `compositions`: a blocked item has no composition.
 *
 * **The cap is checked per item, not once.** `assertUnderTaskCap` is a
 * point-in-time gate: it throws only once month-to-date spend has already
 * reached the cap, so a thirty-item run passes it with a cent of headroom and
 * then bills all thirty. Checking before each item is what actually stops a
 * run partway through, and `noteTaskSpend` keeps the service's 30-second
 * spend cache honest inside the loop.
 *
 * **Nothing leaves unapproved.** Each item carries a verdict, default
 * 'pending'. Approval is a human act and this service only records it.
 */

const pool = require('../db');
const compositions = require('./compositions');
const templates = require('./compositionTemplates');
const queue = require('./compositionRenderQueue');
const budget = require('./budget');
const runner = require('./compositionRenderRunner');

const BATCH_COLS = `id, client_id, created_by, template_id, seed, brief,
                    estimate_usd, created_at, updated_at`;
const ITEM_COLS = `id, batch_id, idx, ref, composition_id, render_id, problems,
                   verdict, verdict_note, verdict_by, verdict_at, created_at, updated_at`;

/** The task budget a batch spends against. Seeded by migration 248. */
const TASK = 'video_batch';

let _batchMod = null;
async function batchMod() {
  if (!_batchMod) {
    const { pathToFileURL } = require('url');
    const path = require('path');
    _batchMod = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'compositionBatch.mjs')
    ).href);
  }
  return _batchMod;
}

/**
 * What a run would do, without doing any of it.
 *
 * The pure arithmetic lives in shared/compositionBatch.mjs so it can be
 * tested without a database; this is the part that has to ask the database
 * what the template is and what the budget has left.
 */
async function plan({ templateId, items = [], perItemUsd = null }) {
  const template = templates.byId(templateId);
  if (!template) {
    throw new Error(
      `No template "${templateId}". Known: ${templates.all().map((t) => t.id).join(', ')}.`
    );
  }

  const row = await budget.getTaskBudget(TASK);
  let remainingUsd = null;
  let capUsd = null;
  if (row && row.monthly_cap_usd != null) {
    capUsd = Number(row.monthly_cap_usd);
    const spent = await budget.taskSpendUsd(TASK, { features: row.features });
    remainingUsd = Math.max(0, capUsd - spent);
  }

  const { planBatch } = await batchMod();
  return planBatch({ template, items, perItemUsd, remainingUsd, capUsd });
}

/**
 * Run a batch.
 *
 * Writes the batch, then one item at a time: bind, persist, enqueue. One
 * item's failure is recorded on that item and the loop continues.
 *
 * Returns the batch and its items. The renders are only ENQUEUED — the
 * drainer encodes them, one at a time on this box, and the review sheet
 * watches the queue rather than this call. A thirty-item run therefore
 * returns in about the time thirty inserts take, which is the point: the
 * operator moves on to the next project.
 */
async function run({
  clientId, createdBy = null, templateId, items = [], seed = '', brief = null,
  perItemUsd = null,
}) {
  const template = templates.byId(templateId);
  if (!template) throw new Error(`No template "${templateId}".`);

  const { bindBatch } = await batchMod();
  const pre = await plan({ templateId, items, perItemUsd });
  const bound = bindBatch({ template, items, seed });

  const { rows: br } = await pool.query(
    `INSERT INTO composition_batches
       (client_id, created_by, template_id, seed, brief, estimate_usd)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${BATCH_COLS}`,
    [clientId, createdBy, templateId, seed, brief, pre.estUsd]
  );
  const batch = br[0];

  let stoppedBy = null;

  for (const entry of bound.items) {
    const source = items[entry.index] || {};
    const ref = source.ref == null ? null : String(source.ref);

    // An item the pre-flight blocked, or one that failed to bind. It is a row
    // regardless: the sheet has to be able to say which four of thirty need
    // attention and what they need.
    if (!entry.comp) {
      await pool.query(
        `INSERT INTO composition_batch_items (batch_id, idx, ref, problems)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          batch.id, entry.index, ref,
          JSON.stringify(entry.problems?.length
            ? entry.problems
            : [{ slot: null, says: entry.error || 'could not be built' }]),
        ]
      );
      continue;
    }

    // Stop rather than overspend. Once the cap is reached the remaining items
    // become blocked rows saying so, which is a batch an operator can resume
    // next month or after raising the cap — not a batch that silently did
    // eleven of thirty.
    if (!stoppedBy) {
      try {
        await budget.assertUnderTaskCap(TASK);
      } catch (err) {
        stoppedBy = err.message;
      }
    }
    if (stoppedBy) {
      await pool.query(
        `INSERT INTO composition_batch_items (batch_id, idx, ref, problems)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [batch.id, entry.index, ref, JSON.stringify([{ slot: null, says: stoppedBy }])]
      );
      continue;
    }

    try {
      // `source_assets` is read back off the BOUND composition, not
      // pre-computed: the binder mints its source ids at bind time, so the
      // caller cannot know them. Both are written, because the render path
      // reads the column and a source's own `asset`, and a composition that
      // carries both survives an editor round trip either way.
      const sourceAssets = {};
      for (const [sid, src] of Object.entries(entry.comp.sources || {})) {
        if (src.asset != null) sourceAssets[sid] = src.asset;
      }

      const comp = await compositions.create({
        clientId,
        createdBy,
        title: `${template.name} ${entry.index + 1}`,
        data: entry.comp,
        sourceAssets,
        batchId: batch.id,
        templateId,
      });

      const job = await queue.enqueue(comp.id);

      await pool.query(
        `INSERT INTO composition_batch_items
           (batch_id, idx, ref, composition_id, render_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [batch.id, entry.index, ref, comp.id, job.id]
      );
    } catch (err) {
      // A fault in persisting or enqueueing THIS item. The rest still run.
      await pool.query(
        `INSERT INTO composition_batch_items (batch_id, idx, ref, problems)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (batch_id, idx) DO UPDATE SET problems = EXCLUDED.problems`,
        [batch.id, entry.index, ref, JSON.stringify([{ slot: null, says: err.message }])]
      );
    }
  }

  // Start encoding after everything is enqueued, so the drainer does not race
  // the inserts and find an empty queue.
  runner.kick();

  return { batch, items: await listItems(batch.id), stoppedBy };
}

/**
 * One batch's items, with their live render state.
 *
 * The render's status is JOINED rather than copied onto the item. A copy goes
 * stale the moment the encoder updates the render row, and the encoder has no
 * reason to know a batch exists.
 */
async function listItems(batchId) {
  const { rows } = await pool.query(
    `SELECT i.id, i.batch_id, i.idx, i.ref, i.composition_id, i.render_id,
            i.problems, i.verdict, i.verdict_note, i.verdict_at,
            c.title,
            r.status  AS render_status,
            r.progress AS render_progress,
            r.output_url, r.error AS render_error,
            r.qc_verdict, r.qc_rank, r.qc
       FROM composition_batch_items i
       LEFT JOIN compositions        c ON c.id = i.composition_id
       LEFT JOIN composition_renders r ON r.id = i.render_id
      WHERE i.batch_id = $1
      ORDER BY i.idx`,
    [batchId]
  );
  return rows.map((r) => ({
    ...r,
    // One word for the sheet's left-hand column. A blocked item has no render
    // and must not read as 'pending': it is not waiting for anything, it is
    // waiting for the operator.
    state: !r.composition_id ? 'blocked'
      : r.render_status === 'done' ? 'rendered'
        : r.render_status === 'failed' ? 'failed'
          : r.render_status || 'queued',
  }));
}

/**
 * The roll-up above the sheet.
 *
 * `suspect` is the figure that decides where to start: how many finished
 * videos the QC gate thinks are broken or worth a look. Without it the only
 * honest instruction is "watch all thirty", which is the afternoon the batch
 * was supposed to save.
 */
async function summary(batchId) {
  const items = await listItems(batchId);
  const count = (f) => items.filter(f).length;
  const awaiting = (i) => i.verdict === 'pending' && i.state === 'rendered';
  return {
    total: items.length,
    blocked: count((i) => i.state === 'blocked'),
    queued: count((i) => i.state === 'queued' || i.state === 'rendering'),
    rendered: count((i) => i.state === 'rendered'),
    failed: count((i) => i.state === 'failed'),
    approved: count((i) => i.verdict === 'approved'),
    rejected: count((i) => i.verdict === 'rejected'),
    pending: count(awaiting),
    // Of the ones still awaiting a human, how many the machine doubts.
    qc_fail: count((i) => awaiting(i) && i.qc_verdict === 'fail'),
    qc_look: count((i) => awaiting(i) && i.qc_verdict === 'look'),
    qc_clean: count((i) => awaiting(i) && i.qc_verdict === 'pass'),
    suspect: count((i) => awaiting(i) && (i.qc_verdict === 'fail' || i.qc_verdict === 'look')),
  };
}

/**
 * The same items, worst first.
 *
 * The sheet's default order, and the whole reason the QC gate exists: the
 * operator's first click should be the most broken video rather than the
 * first one submitted. Within a verdict, the item index keeps it stable so
 * the list does not reshuffle between polls.
 */
async function listItemsByRisk(batchId) {
  const items = await listItems(batchId);
  const rank = (i) => {
    if (i.state === 'failed') return 400;
    if (i.state === 'blocked') return 300;
    if (Number.isFinite(i.qc_rank)) return Math.min(299, i.qc_rank);
    return 0;
  };
  return items.slice().sort((a, b) => (rank(b) - rank(a)) || (a.idx - b.idx));
}

async function get(batchId) {
  const { rows } = await pool.query(
    `SELECT ${BATCH_COLS} FROM composition_batches WHERE id = $1`, [batchId]
  );
  if (!rows[0]) return null;
  // Worst first: that is the order the sheet is for.
  return {
    ...rows[0],
    items: await listItemsByRisk(batchId),
    summary: await summary(batchId),
  };
}

async function list(clientId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT b.id, b.client_id, b.created_by, b.template_id, b.seed, b.brief,
            b.estimate_usd, b.created_at, b.updated_at,
            COUNT(i.id)::int AS total,
            COUNT(i.id) FILTER (WHERE i.verdict = 'approved')::int AS approved
       FROM composition_batches b
       LEFT JOIN composition_batch_items i ON i.batch_id = b.id
      WHERE b.client_id = $1
      GROUP BY b.id
      ORDER BY b.created_at DESC
      LIMIT $2`,
    [clientId, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return rows;
}

/**
 * Approve or reject one item.
 *
 * Only an item that has actually rendered can be approved: approving a
 * blocked or failed item would put a verdict on something that does not
 * exist, and the whole point of the sheet is that nothing leaves for Drive or
 * Instagram unapproved.
 */
async function setVerdict(itemId, { verdict, note = null, by = null }) {
  if (!['pending', 'approved', 'rejected'].includes(verdict)) {
    throw new Error(`Unknown verdict "${verdict}".`);
  }
  const { rows: cur } = await pool.query(
    `SELECT i.id, i.composition_id, r.status AS render_status
       FROM composition_batch_items i
       LEFT JOIN composition_renders r ON r.id = i.render_id
      WHERE i.id = $1`,
    [itemId]
  );
  const item = cur[0];
  if (!item) return null;
  if (verdict === 'approved' && item.render_status !== 'done') {
    throw new Error(
      item.composition_id
        ? 'This item has not finished rendering, so there is nothing to approve yet.'
        : 'This item never ran, so there is nothing to approve.'
    );
  }

  const { rows } = await pool.query(
    `UPDATE composition_batch_items SET
       verdict = $2, verdict_note = $3, verdict_by = $4,
       verdict_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
       updated_at = now()
     WHERE id = $1
     RETURNING ${ITEM_COLS}`,
    [itemId, verdict, note, by]
  );
  return rows[0] || null;
}

/**
 * Re-run one item's render.
 *
 * For a render that failed on circumstance rather than on its own timeline.
 * A new render row rather than a reset of the old one, so the sheet keeps the
 * history of what was tried.
 */
async function retryItem(itemId) {
  const { rows: cur } = await pool.query(
    'SELECT id, composition_id FROM composition_batch_items WHERE id = $1', [itemId]
  );
  const item = cur[0];
  if (!item) return null;
  if (!item.composition_id) {
    throw new Error('This item has no composition to render. Fix its content and run again.');
  }
  const job = await queue.enqueue(item.composition_id);
  const { rows } = await pool.query(
    `UPDATE composition_batch_items
        SET render_id = $2, verdict = 'pending', verdict_note = NULL,
            verdict_by = NULL, verdict_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${ITEM_COLS}`,
    [itemId, job.id]
  );
  runner.kick();
  return rows[0] || null;
}

module.exports = {
  TASK,
  plan,
  run,
  get,
  list,
  listItems,
  listItemsByRisk,
  summary,
  setVerdict,
  retryItem,
};

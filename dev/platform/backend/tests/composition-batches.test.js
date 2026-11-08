/**
 * A batch's bookkeeping decisions, without a database.
 *
 * The behaviour under a real thirty-item run is proved in
 * `composition-batches.db.test.js`, which needs a Postgres and so does not
 * run in CI. What runs here are the decisions an operator acts on, because
 * every one of them is a judgement that could be changed by accident:
 *
 *   - what single word describes an item, which is the sheet's left column;
 *   - which number means "needs looking at", which is the only figure
 *     somebody reads before deciding whether to open the batch at all;
 *   - that a verdict cannot be put on something that has not rendered;
 *   - and that the render's state is JOINED rather than copied, because a
 *     copy goes stale the moment the encoder updates the render row and the
 *     encoder has no reason to know a batch exists.
 *
 *   node tests/composition-batches.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const calls = [];
const fakePool = {
  query: async (sql, params) => {
    calls.push({ sql, params });
    const r = fakePool._results.length ? fakePool._results.shift() : fakePool._result;
    return r;
  },
  _result: { rows: [] },
  _results: [],
};

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

const batches = require('../src/services/compositionBatches');

const last = () => calls[calls.length - 1];
const squash = (s) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => { calls.length = 0; fakePool._result = { rows: [] }; fakePool._results = []; });

/** A row as the listItems join returns it. */
const row = (over = {}) => ({
  id: 1, batch_id: 9, idx: 0, ref: 'post-0', composition_id: 100, render_id: 200,
  problems: [], verdict: 'pending', verdict_note: null, verdict_at: null,
  title: 'Stills montage 1', render_status: 'queued', render_progress: 0,
  output_url: null, render_error: null, ...over,
});

// ── one word for the sheet's left column ─────────────────────────────

describe('an item\'s state', () => {
  const stateOf = async (over) => {
    fakePool._result = { rows: [row(over)] };
    return (await batches.listItems(9))[0].state;
  };

  it('is "blocked" when the item has no composition', async () => {
    // The pre-flight refused it. It is not waiting for a renderer, it is
    // waiting for the operator to go and upload two more photographs, and
    // calling that "pending" sends somebody to look at a video that will
    // never exist.
    assert.equal(await stateOf({ composition_id: null, render_id: null, render_status: null }), 'blocked');
  });

  it('is "rendered" when its render is done', async () => {
    assert.equal(await stateOf({ render_status: 'done' }), 'rendered');
  });

  it('is "failed" when its render failed', async () => {
    assert.equal(await stateOf({ render_status: 'failed' }), 'failed');
  });

  it('passes the render\'s own word through otherwise', async () => {
    assert.equal(await stateOf({ render_status: 'rendering' }), 'rendering');
    assert.equal(await stateOf({ render_status: 'queued' }), 'queued');
  });

  it('is "queued" when a composition exists but no render row does yet', async () => {
    assert.equal(await stateOf({ render_id: null, render_status: null }), 'queued');
  });

  it('is derived from a JOIN, not from a column on the item', async () => {
    // A copy of the render's status on the item would go stale the moment the
    // encoder updated the render row, and the encoder has no reason to know a
    // batch exists.
    await batches.listItems(9);
    const sql = squash(last().sql);
    assert.match(sql, /LEFT JOIN composition_renders r ON r\.id = i\.render_id/);
    assert.ok(
      !/i\.render_status|i\.state/.test(sql),
      'the item table must not carry a copy of the render status'
    );
  });

  it('orders by the item index, so the sheet matches what was submitted', async () => {
    await batches.listItems(9);
    assert.match(squash(last().sql), /ORDER BY i\.idx/);
  });
});

// ── the roll-up ──────────────────────────────────────────────────────

describe('the roll-up', () => {
  const summaryOf = async (rows) => {
    fakePool._result = { rows };
    return batches.summary(9);
  };

  it('counts each state once', async () => {
    const s = await summaryOf([
      row({ id: 1, composition_id: null, render_id: null, render_status: null }),
      row({ id: 2, render_status: 'queued' }),
      row({ id: 3, render_status: 'rendering' }),
      row({ id: 4, render_status: 'done' }),
      row({ id: 5, render_status: 'done', verdict: 'approved' }),
      row({ id: 6, render_status: 'failed' }),
      row({ id: 7, render_status: 'done', verdict: 'rejected' }),
    ]);
    // Three are 'done' (4, 5, 7). Of those, one is still unjudged, so
    // `pending` is 1 — not 2, which is what an earlier draft of this test
    // claimed by miscounting its own fixture.
    assert.deepEqual(s, {
      total: 7,
      blocked: 1,
      queued: 2,
      rendered: 3,
      failed: 1,
      approved: 1,
      rejected: 1,
      pending: 1,
    });
  });

  it('counts a rendering item as waiting, not as rendered', async () => {
    const s = await summaryOf([row({ render_status: 'rendering' })]);
    assert.equal(s.queued, 1);
    assert.equal(s.rendered, 0);
  });

  it('never counts a blocked or failed item as awaiting review', async () => {
    // `pending` is the one figure an operator acts on: it is how many videos
    // are sitting there waiting to be judged. Including items with no video
    // sends them to look at nothing.
    const s = await summaryOf([
      row({ id: 1, composition_id: null, render_id: null, render_status: null }),
      row({ id: 2, render_status: 'failed' }),
      row({ id: 3, render_status: 'queued' }),
    ]);
    assert.equal(s.pending, 0);
    assert.equal(s.total, 3, 'while still accounting for all three');
  });

  it('adds up to the total across the state columns', async () => {
    const rows = [
      row({ id: 1, composition_id: null, render_id: null, render_status: null }),
      row({ id: 2, render_status: 'queued' }),
      row({ id: 3, render_status: 'done' }),
      row({ id: 4, render_status: 'failed' }),
    ];
    const s = await summaryOf(rows);
    assert.equal(
      s.blocked + s.queued + s.rendered + s.failed, s.total,
      'every item is in exactly one state, or the sheet loses some'
    );
  });
});

// ── verdicts ─────────────────────────────────────────────────────────

describe('a verdict', () => {
  it('is refused if it is not one of the three', async () => {
    await assert.rejects(
      () => batches.setVerdict(1, { verdict: 'maybe' }),
      /Unknown verdict "maybe"/
    );
  });

  it('cannot approve an item that has not finished rendering', async () => {
    fakePool._results = [{ rows: [{ id: 1, composition_id: 100, render_status: 'rendering' }] }];
    await assert.rejects(
      () => batches.setVerdict(1, { verdict: 'approved' }),
      /has not finished rendering/
    );
  });

  it('cannot approve an item that never ran, and says so differently', async () => {
    // A different sentence on purpose: one tells you to wait, the other tells
    // you to go and fix the content.
    fakePool._results = [{ rows: [{ id: 1, composition_id: null, render_status: null }] }];
    await assert.rejects(
      () => batches.setVerdict(1, { verdict: 'approved' }),
      /never ran/
    );
  });

  it('CAN reject an item that never ran, which is how the sheet is cleared', async () => {
    fakePool._results = [
      { rows: [{ id: 1, composition_id: null, render_status: null }] },
      { rows: [{ id: 1, verdict: 'rejected' }] },
    ];
    const out = await batches.setVerdict(1, { verdict: 'rejected', note: 'wrong folder' });
    assert.equal(out.verdict, 'rejected');
  });

  it('clears the timestamp when a verdict is taken back', async () => {
    fakePool._results = [
      { rows: [{ id: 1, composition_id: 100, render_status: 'done' }] },
      { rows: [{ id: 1, verdict: 'pending', verdict_at: null }] },
    ];
    await batches.setVerdict(1, { verdict: 'pending' });
    assert.match(
      squash(last().sql),
      /verdict_at = CASE WHEN \$2 = 'pending' THEN NULL ELSE now\(\) END/
    );
  });

  it('records who decided', async () => {
    fakePool._results = [
      { rows: [{ id: 1, composition_id: 100, render_status: 'done' }] },
      { rows: [{ id: 1 }] },
    ];
    await batches.setVerdict(1, { verdict: 'approved', by: 'user-1' });
    assert.equal(last().params[3], 'user-1');
  });

  it('returns null for an item that does not exist', async () => {
    fakePool._results = [{ rows: [] }];
    assert.equal(await batches.setVerdict(999, { verdict: 'rejected' }), null);
  });
});

// ── retrying ─────────────────────────────────────────────────────────

describe('retrying an item', () => {
  it('refuses an item with no composition, and says what to do instead', async () => {
    fakePool._results = [{ rows: [{ id: 1, composition_id: null }] }];
    await assert.rejects(
      () => batches.retryItem(1),
      /no composition to render\. Fix its content and run again/
    );
  });

  it('clears the verdict, because the file it was given is being replaced', async () => {
    fakePool._results = [
      { rows: [{ id: 1, composition_id: 100 }] },
      { rows: [{ id: 300, status: 'queued' }] },
      { rows: [{ id: 1, render_id: 300, verdict: 'pending' }] },
    ];
    const out = await batches.retryItem(1);
    assert.equal(out.verdict, 'pending');
    // Found among the calls rather than taken from the last one: retryItem
    // kicks the drain, so the final query against the stub is the queue's
    // claim, not this update.
    const update = calls.find((c) => /UPDATE composition_batch_items/.test(c.sql));
    assert.ok(update, 'the item was updated');
    assert.match(squash(update.sql), /verdict = 'pending', verdict_note = NULL/);
  });
});

// ── the shape of the service ─────────────────────────────────────────

describe('the service', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'compositionBatches.js'), 'utf8'
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('checks the task cap inside the loop, not once before it', () => {
    // `assertUnderTaskCap` is a point-in-time gate: it throws only once
    // month-to-date spend has ALREADY reached the cap. A single check before
    // a thirty-item run passes with a cent of headroom and then bills all
    // thirty, so the check has to be where it can stop the run partway.
    const loop = code.indexOf('for (const entry of bound.items)');
    const check = code.indexOf('assertUnderTaskCap');
    assert.ok(loop > 0 && check > 0, 'both are present');
    assert.ok(
      check > loop,
      'the cap check must be inside the per-item loop, or it cannot stop a run'
    );
  });

  it('writes a row for an item it could not build', () => {
    // An operator who submitted thirty and got twenty-six has to be able to
    // see which four and why. A `batch_id` on compositions cannot represent
    // an item that has no composition.
    assert.match(
      code, /if \(!entry\.comp\)[\s\S]{0,400}INSERT INTO composition_batch_items/,
      'a blocked item is still a row, carrying its problems'
    );
  });

  it('reads source_assets off the bound composition rather than pre-computing it', () => {
    // The binder mints its source ids at bind time, so the caller cannot know
    // them. The route that resolved only this column could not render a
    // template-built composition at all.
    assert.match(code, /Object\.entries\(entry\.comp\.sources/);
  });

  it('keeps going after one item throws', () => {
    // Per-item failure must not fail the batch. The old stills path passed
    // provider errors straight through, which for one video is right and for
    // thirty is the difference between twenty-nine and none.
    assert.match(
      code, /catch \(err\)[\s\S]{0,500}INSERT INTO composition_batch_items/,
      'a throw inside the loop becomes that item\'s problem, not the batch\'s'
    );
  });

  it('starts the drain after everything is enqueued, not during', () => {
    const loopEnd = code.lastIndexOf('INSERT INTO composition_batch_items');
    const kick = code.indexOf('runner.kick()');
    assert.ok(kick > loopEnd, 'kicking mid-loop races the inserts and finds an empty queue');
  });
});

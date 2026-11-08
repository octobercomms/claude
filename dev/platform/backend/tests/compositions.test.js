const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Stub the DB pool by injecting into require.cache before loading the service.
let lastQuery = null;
const fakePool = {
  query: async (sql, params) => { lastQuery = { sql, params }; return fakePool._result; },
  _result: { rows: [] },
};

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

const compositions = require('../src/services/compositions');

describe('compositions service', () => {
  beforeEach(() => { lastQuery = null; fakePool._result = { rows: [] }; });

  it('create inserts a row and returns it', async () => {
    const fakeRow = { id: 1, title: 'Test', client_id: 10 };
    fakePool._result = { rows: [fakeRow] };
    const result = await compositions.create({ clientId: 10, createdBy: 5, title: 'Test', data: { fps: 30 } });
    assert.equal(result, fakeRow);
    assert.ok(lastQuery.sql.includes('INSERT INTO compositions'));
    assert.deepEqual(lastQuery.params[0], 10);
    assert.deepEqual(lastQuery.params[1], 5);
    assert.deepEqual(lastQuery.params[2], 'Test');
    assert.deepEqual(lastQuery.params[3], JSON.stringify({ fps: 30 }));
  });

  it('create defaults title to Untitled and data to empty', async () => {
    fakePool._result = { rows: [{ id: 2 }] };
    await compositions.create({ clientId: 10 });
    assert.deepEqual(lastQuery.params[2], 'Untitled');
    assert.deepEqual(lastQuery.params[3], '{}');
  });

  it('list returns rows for a client', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    fakePool._result = { rows };
    const result = await compositions.list(10);
    assert.deepEqual(result, rows);
    assert.ok(lastQuery.sql.includes('WHERE client_id'));
    // The limit is a parameter, not interpolated into the SQL.
    assert.deepEqual(lastQuery.params, [10, 100]);
  });

  it('list can narrow to one batch', async () => {
    fakePool._result = { rows: [] };
    await compositions.list(10, { batchId: 7 });
    assert.ok(lastQuery.sql.includes('batch_id = $2'));
    assert.deepEqual(lastQuery.params, [10, 7, 100]);
  });

  it('list can leave a batch\'s items out of the editor\'s picker', async () => {
    // The list is capped, so a thirty-item batch would otherwise push a
    // third of somebody's hand-built work out of the only list there is.
    fakePool._result = { rows: [] };
    await compositions.list(10, { excludeBatched: true });
    assert.ok(lastQuery.sql.includes('batch_id IS NULL'));
    assert.deepEqual(lastQuery.params, [10, 100]);
  });

  it('list clamps a silly limit rather than passing it through', async () => {
    fakePool._result = { rows: [] };
    await compositions.list(10, { limit: 99999 });
    assert.equal(lastQuery.params[1], 500);
    await compositions.list(10, { limit: 0 });
    assert.equal(lastQuery.params[1], 100, 'zero is not a limit, it is a missing one');
    await compositions.list(10, { limit: -5 });
    assert.equal(lastQuery.params[1], 1);
  });

  it('create writes the batch and template it came from', async () => {
    // A new column that is not in COLS is silently absent from every
    // RETURNING, so a caller that wrote it reads back a row that appears not
    // to have it. These two were added by migration 249.
    fakePool._result = { rows: [{ id: 3 }] };
    await compositions.create({
      clientId: 10, title: 'Item 3', data: { version: 1 }, batchId: 42, templateId: 'stills-montage',
    });
    assert.ok(lastQuery.sql.includes('batch_id'));
    assert.ok(lastQuery.sql.includes('template_id'));
    assert.ok(lastQuery.sql.includes('RETURNING'));
    assert.ok(/RETURNING[\s\S]*batch_id/.test(lastQuery.sql), 'and reads them back');
    assert.equal(lastQuery.params[6], 42);
    assert.equal(lastQuery.params[7], 'stills-montage');
  });

  it('create maps assets in the same statement, not a follow-up update', async () => {
    // A batch writing thirty would otherwise need two round trips per item,
    // with a window in which a composition exists and has no assets.
    fakePool._result = { rows: [{ id: 4 }] };
    await compositions.create({
      clientId: 10, data: { version: 1 }, sourceAssets: { s1: 'a1' },
    });
    assert.ok(lastQuery.sql.includes('source_assets'));
    assert.equal(lastQuery.params[4], JSON.stringify({ s1: 'a1' }));
  });

  it('get returns a single row or null', async () => {
    fakePool._result = { rows: [{ id: 5 }] };
    assert.deepEqual(await compositions.get(5), { id: 5 });
    fakePool._result = { rows: [] };
    assert.equal(await compositions.get(99), null);
  });

  it('update builds SET clause for provided fields only', async () => {
    fakePool._result = { rows: [{ id: 1 }] };
    await compositions.update(1, { title: 'New' });
    assert.ok(lastQuery.sql.includes('title = $1'));
    assert.ok(!lastQuery.sql.includes('data ='));
    assert.ok(!lastQuery.sql.includes('source_assets ='));
    assert.ok(!lastQuery.sql.includes('transcripts ='));
    assert.ok(!lastQuery.sql.includes('status ='));
    assert.deepEqual(lastQuery.params, ['New', 1]);
  });

  it('update sets all fields when all are provided', async () => {
    fakePool._result = { rows: [{ id: 1 }] };
    await compositions.update(1, {
      title: 'T', data: { a: 1 }, sourceAssets: { s1: 10 },
      transcripts: { s1: [] }, status: 'rendering',
    });
    assert.ok(lastQuery.sql.includes('title = $1'));
    assert.ok(lastQuery.sql.includes('data = $2'));
    assert.ok(lastQuery.sql.includes('source_assets = $3'));
    assert.ok(lastQuery.sql.includes('transcripts = $4'));
    assert.ok(lastQuery.sql.includes('status = $5'));
    assert.deepEqual(lastQuery.params, ['T', '{"a":1}', '{"s1":10}', '{"s1":[]}', 'rendering', 1]);
  });

  it('update returns null when row not found', async () => {
    fakePool._result = { rows: [] };
    assert.equal(await compositions.update(99, { title: 'X' }), null);
  });

  it('remove deletes the row', async () => {
    fakePool._result = { rows: [] };
    await compositions.remove(7);
    assert.ok(lastQuery.sql.includes('DELETE FROM compositions'));
    assert.deepEqual(lastQuery.params, [7]);
  });
});

/**
 * The results export, past row 1,000.
 *
 * It used to fetch /analytics with limit=100000. That route clamps to
 * Math.min(1000, …) to keep the on-screen table cheap, so the browser asked for
 * everything, got the first 1,000, and wrote a CSV that looked complete. On a
 * 10,598-recipient release that is 9,598 journalists missing from a file that
 * was then reviewed as if it were the whole list.
 *
 * So the one assertion that matters here is a row count above the old cap.
 * 1,250 recipients: enough to cross it and to need two batches.
 *
 * Needs a database:
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=... node tests/press-export.test.js
 */
const nodePath = require('path');
const path = nodePath.join(__dirname, '..') + nodePath.sep;
require.cache[require.resolve(path + 'src/middleware/auth.js')] = {
  id: 'auth', loaded: true,
  exports: { authenticate: (req, _res, next) => { req.user = { id: '00000000-0000-0000-0000-000000000001', role: 'admin' }; next(); } },
};
const express = require('express');
const pool = require(path + 'src/db');
const ca = require(path + 'src/middleware/clientAccess');

let failures = 0;
const ok = (c, l) => { if (c) console.log('  ok   ' + l); else { console.log('  FAIL ' + l); failures++; } };
const N = 1250;

(async () => {
  const SLUG = 'exportprobe-' + Date.now();
  let clientId, otherId, campaignId, releaseId, srv;
  try {
    ({ rows: [{ id: clientId }] } = await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id', [SLUG]));
    ({ rows: [{ id: otherId }] } = await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id', [SLUG + '-other']));
    ({ rows: [{ id: campaignId }] } = await pool.query(
      "INSERT INTO outreach_campaigns (client_id,name,kind,campaign_type) VALUES ($1,$2,'press_release','press') RETURNING id", [clientId, SLUG]));
    ({ rows: [{ id: releaseId }] } = await pool.query(
      "INSERT INTO outreach_press_releases (client_id,campaign_id,title) VALUES ($1,$2,'Export probe, with a comma') RETURNING id", [clientId, campaignId]));
    const { rows: [seq] } = await pool.query(
      "INSERT INTO outreach_sequences (campaign_id,step_number,subject,delay_days) VALUES ($1,1,'S',0) RETURNING id", [campaignId]);

    // Bulk insert — 1,250 one at a time is slow enough to matter.
    await pool.query(
      `INSERT INTO outreach_contacts (name, email, kind, status, company)
       SELECT 'EX ' || g, $1 || '-' || g || '@e.com', 'media', 'active', 'Outlet, Inc'
         FROM generate_series(1, $2) g`, [SLUG, N]);
    const { rows: made } = await pool.query(
      'SELECT id FROM outreach_contacts WHERE email LIKE $1 ORDER BY email', [SLUG + '-%']);
    ok(made.length === N, `${N} journalists seeded`);
    const ids = made.map(r => r.id);
    await pool.query(
      `INSERT INTO outreach_contact_clients (contact_id, client_id)
       SELECT id, $2 FROM unnest($1::uuid[]) AS t(id)`, [ids, clientId]);
    await pool.query(
      `INSERT INTO outreach_sends (campaign_id, contact_id, sequence_id, status, open_count, scheduled_at)
       SELECT $1, id, $2, 'sent', 1, NOW() FROM unnest($3::uuid[]) AS t(id)`, [campaignId, seq.id, ids]);
    // One journalist with a click, to prove the click join survives batching.
    const { rows: [firstSend] } = await pool.query(
      'SELECT id FROM outreach_sends WHERE campaign_id = $1 AND contact_id = $2', [campaignId, ids[0]]);
    await pool.query("INSERT INTO outreach_clicks (send_id,url) VALUES ($1,'https://x.test/a'),($1,'https://x.test/b')", [firstSend.id]);

    const app = express();
    app.use(express.json());
    let visible = [clientId];
    app.use((req, _res, next) => { req.visibleClientIds = visible; next(); });
    ca.loadVisibleClientIds = (_req, _res, next) => next();
    app.use('/api/press', require(path + 'src/routes/press.js'));
    srv = app.listen(0);
    const port = srv.address().port;
    const get = async (p) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/press${p}`);
      return { status: r.status, text: await r.text(), type: r.headers.get('content-type'), disp: r.headers.get('content-disposition') };
    };

    console.log('\nThe export is not capped at 1,000');
    const r = await get(`/releases/${releaseId}/export.csv`);
    ok(r.status === 200, 'the export responds');
    const lines = r.text.trim().split('\n');
    ok(lines.length === N + 1, `every recipient is in the file: ${lines.length - 1} rows + header (the old cap gave 1000)`);
    ok(lines.length - 1 > 1000, 'and it is past the cap that silently truncated it');

    console.log('\nThe file is a usable CSV');
    ok(/text\/csv/.test(r.type || ''), 'served as text/csv');
    ok(/attachment; filename="press-results-export-probe-with-a-comma\.csv"/.test(r.disp || ''),
      'with a filename slugged from the title');
    ok(lines[0].startsWith('Name,Email,Outlet,Opens,Clicks'), 'headers first');
    // Count fields properly rather than counting commas: the whole risk with a
    // hand-rolled CSV is a quoted value shifting every column after it.
    const fields = (line) => {
      let n = 1, inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQ && line[i + 1] === '"') i++; else inQ = !inQ; }
        else if (ch === ',' && !inQ) n++;
      }
      return n;
    };
    const want = fields(lines[0]);
    const bad = lines.findIndex(l => fields(l) !== want);
    ok(bad === -1, `every row has the same ${want} columns as the header${bad === -1 ? '' : ` (row ${bad} has ${fields(lines[bad])})`}`);
    const outletQuoted = lines[1].includes('"Outlet, Inc"');
    ok(outletQuoted, 'a value containing a comma is quoted, so columns do not shift');
    const clicker = lines.find(l => l.includes('Clicks') === false && l.includes('x.test'));
    ok(!!clicker && clicker.includes('https://x.test/a | https://x.test/b'),
      'clicked URLs survive the batching and are joined into one cell');

    console.log('\nSearch and access still apply');
    const one = await get(`/releases/${releaseId}/export.csv?q=EX%201000`);
    ok(one.text.trim().split('\n').length - 1 >= 1, 'a search narrows the file rather than being ignored');
    ok(one.text.trim().split('\n').length - 1 < N, 'and really narrows it');
    visible = [otherId];
    ok((await get(`/releases/${releaseId}/export.csv`)).status === 403, 'another client cannot export this release');
    visible = [clientId];
  } catch (err) {
    console.error('\nTEST ERROR:', err.message, '\n', err.stack);
    failures++;
  } finally {
    if (srv) srv.close();
    if (clientId) {
      await pool.query('DELETE FROM outreach_campaigns WHERE client_id = $1', [clientId]);
      await pool.query('DELETE FROM outreach_contacts WHERE email LIKE $1', [SLUG + '-%']);
      await pool.query('DELETE FROM clients WHERE id = ANY($1::uuid[])', [[clientId, otherId]]);
    }
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})().catch((e) => { console.error('\nTEST ERROR:', e); process.exit(1); });

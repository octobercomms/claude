/**
 * The warm rule, and the thing that was missing: changing it changes the answer.
 *
 * Before this, the rule was read only at the moment an open or click arrived.
 * Moving the bar changed nothing already recorded, and warm was sticky in one
 * direction — raising the threshold never un-warmed anybody. So the AM could
 * edit the setting, watch the list not move, and conclude the control was dead.
 *
 * Needs a database:
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=... node tests/press-warm.test.js
 */
const nodePath = require('path');
const path = nodePath.join(__dirname, '..') + nodePath.sep;
const pool = require(path + 'src/db');
const pi = require(path + 'src/services/pressInterest');

let failures = 0;
const ok = (c, l) => { if (c) console.log('  ok   ' + l); else { console.log('  FAIL ' + l); failures++; } };

(async () => {
  const SLUG = 'warmprobe-' + Date.now();
  let clientId, campaignId;
  const contacts = {};
  try {
    ({ rows: [{ id: clientId }] } = await pool.query(
      'INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id', [SLUG]));
    ({ rows: [{ id: campaignId }] } = await pool.query(
      "INSERT INTO outreach_campaigns (client_id,name,campaign_type,kind) VALUES ($1,$2,'press','press_release') RETURNING id",
      [clientId, SLUG]));
    const { rows: [seq] } = await pool.query(
      "INSERT INTO outreach_sequences (campaign_id,step_number,subject,delay_days) VALUES ($1,1,'S',0) RETURNING id",
      [campaignId]);

    // Four journalists with different engagement, which is the whole point:
    // each one changes category at a different setting.
    const people = [
      ['clicker',  0, 1],   // a click, no opens — the only human signal
      ['opener5',  5, 0],   // five opens, no click — could be an image proxy
      ['opener2',  2, 0],
      ['silent',   0, 0],
    ];
    for (const [name, opens, clicks] of people) {
      const { rows: [c] } = await pool.query(
        "INSERT INTO outreach_contacts (name,email,kind,status) VALUES ($1,$2,'media','active') RETURNING id",
        [name, `${SLUG}-${name}@e.com`]);
      contacts[name] = c.id;
      await pool.query('INSERT INTO outreach_contact_clients (contact_id,client_id) VALUES ($1,$2)', [c.id, clientId]);
      const { rows: [snd] } = await pool.query(
        "INSERT INTO outreach_sends (campaign_id,contact_id,sequence_id,status,open_count,scheduled_at) VALUES ($1,$2,$3,'sent',$4,NOW()) RETURNING id",
        [campaignId, c.id, seq.id, opens]);
      for (let i = 0; i < clicks; i++) {
        await pool.query("INSERT INTO outreach_clicks (send_id,url) VALUES ($1,'https://x.test')", [snd.id]);
      }
    }

    const warmNames = async () => {
      const { rows } = await pool.query(
        `SELECT co.name FROM press_interest_alerts a JOIN outreach_contacts co ON co.id = a.contact_id
          WHERE a.client_id = $1 ORDER BY co.name`, [clientId]);
      return rows.map(r => r.name);
    };
    const flagged = async () => {
      const { rows } = await pool.query(
        `SELECT co.name FROM outreach_contact_clients oc JOIN outreach_contacts co ON co.id = oc.contact_id
          WHERE oc.client_id = $1 AND oc.warm_at IS NOT NULL ORDER BY co.name`, [clientId]);
      return rows.map(r => r.name);
    };
    const setCfg = async (cfg) =>
      pool.query('UPDATE clients SET press_warm_config = $1 WHERE id = $2', [JSON.stringify(cfg), clientId]);

    console.log('\nThe default rule: a click warms, opens never do on their own');
    await setCfg({ min_opens: 0, any_click: true });
    let r = await pi.recompute(clientId);
    ok(r.warmed === 1 && r.cooled === 0, 'one journalist warms, nobody is cooled');
    ok((await warmNames()).join() === 'clicker', 'and it is the one who clicked, not the one with five opens');
    ok((await flagged()).join() === 'clicker', 'the per-contact warm flag matches');

    console.log('\nLowering the bar warms people retrospectively');
    const before = await pi.preview(clientId, { min_opens: 2 });
    ok(before.warm_now === 1 && before.warm_after === 3,
      `the preview says 1 warm now, 3 under the proposed rule (got ${before.warm_now} → ${before.warm_after})`);
    ok(before.newly_warm === 2 && before.no_longer_warm === 0, 'and names it as 2 added, 0 removed');
    const { rows: unchanged } = await pool.query(
      'SELECT COUNT(*)::int n FROM press_interest_alerts WHERE client_id = $1', [clientId]);
    ok(unchanged[0].n === 1, 'a preview writes nothing');

    await setCfg({ min_opens: 2, any_click: true });
    r = await pi.recompute(clientId);
    ok(r.warmed === 3, 'recompute applies it to engagement that already happened');
    ok((await warmNames()).join() === 'clicker,opener2,opener5', 'the two openers join the list');

    console.log('\nRaising the bar takes people back off it');
    r = await pi.recompute(clientId);
    ok(r.cooled === 0, 'running it twice on the same rule changes nothing');
    await setCfg({ min_opens: 4, any_click: true });
    r = await pi.recompute(clientId);
    ok(r.cooled === 1, 'the 2-open journalist is cooled');
    ok((await warmNames()).join() === 'clicker,opener5', 'and is gone from the list');
    ok((await flagged()).join() === 'clicker,opener5', 'the per-contact flag comes off too, which it never used to');

    console.log('\nTurning clicks off leaves only the opens rule');
    await setCfg({ min_opens: 4, any_click: false });
    await pi.recompute(clientId);
    ok((await warmNames()).join() === 'opener5', 'the clicker is no longer warm');

    console.log('\nNobody is mailed about history');
    const { rows: pending } = await pool.query(
      'SELECT COUNT(*)::int n FROM press_interest_alerts WHERE client_id = $1 AND alerted_at IS NULL', [clientId]);
    ok(pending[0].n === 0, 'every recomputed row is marked alerted, so the digest never mails the backlog');

    console.log('\nThe live path still agrees with the recompute');
    await setCfg({ min_opens: 0, any_click: true });
    await pi.recompute(clientId);
    const m = await pi.metrics(campaignId, contacts.opener5);
    ok(pi.scoreAndReason(m, { min_opens: 0, any_click: true }).warm === false,
      'scoreAndReason treats min_opens 0 as off, not as a bar of zero');
    ok(pi.scoreAndReason(await pi.metrics(campaignId, contacts.clicker), { min_opens: 0, any_click: true }).warm === true,
      'and still warms on a click');
  } catch (err) {
    // Without this the throw races the process.exit in `finally` and the run
    // prints "all passed" having executed almost nothing. That exact trap hid a
    // wrong assumption for a whole session already.
    console.error('\nTEST ERROR:', err.message, '\n', err.stack);
    failures++;
  } finally {
    if (clientId) {
      await pool.query('DELETE FROM outreach_campaigns WHERE client_id = $1', [clientId]);
      await pool.query('DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])', [Object.values(contacts)]);
      await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
    }
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})().catch((e) => { console.error('\nTEST ERROR:', e); process.exit(1); });

/**
 * Unsubscribes: detecting them in replies, applying them, and showing them.
 *
 * Two things were wrong. The results screen had no unsubscribe number at all,
 * though every press email carries a one-click link that records one. And a
 * reply saying "unsubscribe" only took effect if a Claude call classified it —
 * inside a try/catch that swallowed failures, so a missing API key meant the
 * journalist kept getting follow-ups.
 *
 * The trap in the keyword path is our own footer: every email we send contains
 * the word "unsubscribe", and most replies quote it back. Matching the whole
 * body would opt out everyone who ever replied, including "yes, send images".
 *
 * Needs a database:
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=... node tests/press-unsubscribe.test.js
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
const replies = require(path + 'src/services/outreachReplies');

let failures = 0;
const ok = (c, l) => { if (c) console.log('  ok   ' + l); else { console.log('  FAIL ' + l); failures++; } };

// A real reply shape: what they typed, then our quoted email with its footer.
const QUOTED_FOOTER = `
On Tue, 7 Oct 2026 at 08:00, Daniel Nelson <daniel@october.test> wrote:
> Hi there, here is the release.
> You can unsubscribe here: https://omi.test/api/unsubscribe?c=123
`;

(async () => {
  const SLUG = 'unsubprobe-' + Date.now();
  let clientId, otherId, campaignId, releaseId, srv;
  const ids = {};
  try {
    console.log('\nReading a reply: what they wrote, not what we quoted');
    ok(replies.looksLikeUnsubscribe('Please unsubscribe me.' + QUOTED_FOOTER), 'a plain "unsubscribe me" is caught');
    ok(replies.looksLikeUnsubscribe('unsubscribe'), 'the one-word reply is caught');
    ok(replies.looksLikeUnsubscribe('Take me off this list please' + QUOTED_FOOTER), '"take me off this list" is caught');
    ok(replies.looksLikeUnsubscribe('Hi — please remove me from your list, thanks'), '"please remove me" is caught');
    ok(replies.looksLikeUnsubscribe('STOP SENDING ME THESE'), 'caught regardless of case');
    // The one that matters: our own footer says "unsubscribe" in every email.
    ok(!replies.looksLikeUnsubscribe('Yes please, send me the images.' + QUOTED_FOOTER),
      'an interested reply quoting our unsubscribe footer is NOT an opt-out');
    ok(!replies.looksLikeUnsubscribe('Thanks, I will take a look.' + QUOTED_FOOTER), 'nor is a polite acknowledgement');
    ok(!replies.looksLikeUnsubscribe('> please remove me'), 'nor is the phrase inside a quoted line');
    ok(!replies.looksLikeUnsubscribe(''), 'an empty body is not an opt-out');
    ok(replies.replyBodyOnly('Mine.\n> theirs\nOn Tue, 7 Oct 2026 at 08:00, X wrote:\n> more') === 'Mine.',
      'the quoted original is stripped before matching');

    ({ rows: [{ id: clientId }] } = await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id', [SLUG]));
    ({ rows: [{ id: otherId }] } = await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id', [SLUG + '-o']));
    ({ rows: [{ id: campaignId }] } = await pool.query(
      "INSERT INTO outreach_campaigns (client_id,name,kind,campaign_type) VALUES ($1,$2,'press_release','press') RETURNING id", [clientId, SLUG]));
    ({ rows: [{ id: releaseId }] } = await pool.query(
      "INSERT INTO outreach_press_releases (client_id,campaign_id,title) VALUES ($1,$2,'Unsub probe') RETURNING id", [clientId, campaignId]));
    const { rows: [seq] } = await pool.query(
      "INSERT INTO outreach_sequences (campaign_id,step_number,subject,delay_days) VALUES ($1,1,'S',0),($1,2,'S2',5) RETURNING id", [campaignId]);
    for (const name of ['quitter', 'stayer']) {
      const { rows: [c] } = await pool.query(
        "INSERT INTO outreach_contacts (name,email,kind,status) VALUES ($1,$2,'media','active') RETURNING id",
        [name, `${SLUG}-${name}@e.com`]);
      ids[name] = c.id;
      await pool.query('INSERT INTO outreach_contact_clients (contact_id,client_id) VALUES ($1,$2)', [c.id, clientId]);
      await pool.query(
        `INSERT INTO outreach_sends (campaign_id,contact_id,sequence_id,status,scheduled_at)
         SELECT $1,$2,id,'pending',NOW() FROM outreach_sequences WHERE campaign_id=$1`, [campaignId, c.id]);
    }

    console.log('\nApplying one stops their queue, for this client only');
    ok(await replies.suppressForCampaign(campaignId, ids.quitter) === true, 'the first call reports the opt-out');
    ok(await replies.suppressForCampaign(campaignId, ids.quitter) === false,
      'a repeat does not count again, so a re-read inbox cannot inflate the number');
    const { rows: pend } = await pool.query(
      "SELECT COUNT(*)::int n FROM outreach_sends WHERE contact_id=$1 AND status='pending'", [ids.quitter]);
    ok(pend[0].n === 0, 'their pending follow-ups are cancelled, not left to claim they are still going out');
    const { rows: other } = await pool.query(
      "SELECT COUNT(*)::int n FROM outreach_sends WHERE contact_id=$1 AND status='pending'", [ids.stayer]);
    ok(other[0].n === 2, 'nobody else is touched');
    const { rows: scope } = await pool.query(
      'SELECT COUNT(*)::int n FROM outreach_contact_clients WHERE contact_id=$1 AND unsubscribed_at IS NOT NULL', [ids.quitter]);
    ok(scope[0].n === 1, 'the opt-out is for this client only, not every client they are on');

    const app = express();
    app.use(express.json());
    let visible = [clientId];
    app.use((req, _res, next) => { req.visibleClientIds = visible; next(); });
    ca.loadVisibleClientIds = (_req, _res, next) => next();
    app.use('/api/press', require(path + 'src/routes/press.js'));
    srv = app.listen(0);
    const port = srv.address().port;
    const call = async (method, p, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/press${p}`, {
        method, headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
    };

    console.log('\nThe results screen can now show it');
    const a = await call('GET', `/releases/${releaseId}/analytics`);
    ok(a.body.totals.unsubscribed === 1, `totals carry the unsubscribe count (got ${a.body.totals.unsubscribed})`);
    ok(typeof a.body.totals.unsub_rate === 'number', 'and a rate alongside the others');

    console.log('\nPasting addresses from Gmail');
    let r = await call('POST', `/clients/${clientId}/unsubscribe-emails`,
      { emails: `Jane Smith <${SLUG}-stayer@e.com>,\n  nobody@nowhere.test\n` });
    ok(r.status === 200 && r.body.unsubscribed === 1, 'the one we know is unsubscribed');
    ok(r.body.unknown.length === 1 && r.body.unknown[0] === 'nobody@nowhere.test',
      'an address we have never emailed is reported back rather than silently dropped');
    const { rows: p2 } = await pool.query(
      "SELECT COUNT(*)::int n FROM outreach_sends WHERE contact_id=$1 AND status='pending'", [ids.stayer]);
    ok(p2[0].n === 0, 'their queued follow-ups stop too');
    r = await call('POST', `/clients/${clientId}/unsubscribe-emails`, { emails: `${SLUG}-stayer@e.com` });
    ok(r.body.unsubscribed === 0 && r.body.already === 1, 'pasting the same person again is reported as already done');
    r = await call('POST', `/clients/${clientId}/unsubscribe-emails`, { emails: 'not an email at all' });
    ok(r.status === 400, 'a paste with no addresses in it is refused');
    visible = [otherId];
    ok((await call('POST', `/clients/${clientId}/unsubscribe-emails`, { emails: 'x@y.com' })).status === 403,
      'another client cannot unsubscribe on this one');
    visible = [clientId];

    console.log('\nThe screen can say whether reply polling is even running');
    r = await call('GET', `/releases/${releaseId}/reply-status`);
    ok(r.status === 200 && typeof r.body.configured === 'boolean', 'the status reports whether an inbox is connected');
    ok('reply_to' in r.body && 'inbox_matches_reply_to' in r.body,
      'and compares it with where journalists actually reply, which is the silent failure');
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

/**
 * Multiple audiences on one press release, and the dedupe that makes them safe.
 *
 * The rule this file exists to protect: a contact can be in exactly one audience
 * per release. Not because a screen checks before send, but because
 * outreach_campaign_contacts has a primary key of (campaign_id, contact_id) and
 * the audience lives on that row. If that ever stops holding, a journalist can
 * receive two different pitches for the same release, 24h apart because the
 * frequency cap delays rather than drops the second — which reads as a mistake,
 * because it is one.
 *
 * Needs a database. Point it at a scratch one:
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=… node tests/press-segments.test.js
 * It creates its own client/campaign/contacts under a 'segtest-' prefix and
 * removes them afterwards, so it is safe to re-run.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');
const seg = require('../src/services/pressSegments');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}`); failures++; }
};
async function throws(fn, label) {
  try { await fn(); ok(false, `${label} (expected a refusal, got none)`); }
  catch { ok(true, label); }
}

const SLUG = `segtest-${Date.now()}`;
let clientId, campaignId;
const contacts = [];

async function seed() {
  const { rows: cl } = await pool.query(
    "INSERT INTO clients (name, slug) VALUES ($1, $1) RETURNING id", [SLUG]);
  clientId = cl[0].id;
  const { rows: cp } = await pool.query(
    "INSERT INTO outreach_campaigns (client_id, name, campaign_type) VALUES ($1, $2, 'press') RETURNING id",
    [clientId, `${SLUG} campaign`]);
  campaignId = cp[0].id;
  for (let i = 0; i < 6; i++) {
    const { rows } = await pool.query(
      `INSERT INTO outreach_contacts (name, email, kind, status)
       VALUES ($1, $2, 'media', 'active') RETURNING id`,
      [`Seg Person ${i}`, `${SLUG}-${i}@example.com`]);
    contacts.push(rows[0].id);
  }
}

async function cleanup() {
  if (campaignId) await pool.query('DELETE FROM outreach_campaigns WHERE id = $1', [campaignId]);
  if (contacts.length) await pool.query('DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])', [contacts]);
  if (clientId) await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
}

(async () => {
  await seed();
  try {
    console.log('\nCreating audiences');
    const work = await seg.create({ campaignId, name: 'Workplace', tags: ['workplace'] });
    const retail = await seg.create({ campaignId, name: 'Retail', tags: ['retail'] });
    ok(work.position === 0 && retail.position === 1, 'positions assigned in creation order');
    await throws(() => seg.create({ campaignId, name: 'workplace' }),
      'a duplicate name is refused, case-insensitively');
    await throws(() => seg.create({ campaignId, name: '  ' }), 'a blank name is refused');

    console.log('\nFiling contacts');
    let r = await seg.assign({ segmentId: work.id, contactIds: contacts.slice(0, 4) });
    ok(r.added === 4 && r.conflicts.length === 0, '4 filed into Workplace, no conflicts');
    r = await seg.assign({ segmentId: work.id, contactIds: contacts.slice(0, 2) });
    ok(r.added === 0 && r.already === 2, 're-filing the same people is a no-op, reported as already');

    console.log('\nThe dedupe');
    r = await seg.assign({ segmentId: retail.id, contactIds: contacts.slice(2, 6) });
    ok(r.added === 2, 'the 2 who were in no audience are filed into Retail');
    ok(r.conflicts.length === 2, 'the 2 already in Workplace come back as conflicts');
    ok(r.conflicts.every((c) => c.current_segment_name === 'Workplace'),
      'each conflict names the audience they are currently in');
    // The point of the whole design: nothing moved on its own.
    let members = await seg.memberIds(work.id);
    ok(members.length === 4, 'Workplace still has all 4 — an overlap never moves anyone silently');

    console.log('\nResolving an overlap');
    const conflictIds = r.conflicts.map((c) => c.contact_id);
    const kept = await seg.resolve({ segmentId: retail.id, contactIds: conflictIds, action: 'keep' });
    ok(kept.moved === 0, "'keep' leaves them where they are");
    const moved = await seg.resolve({ segmentId: retail.id, contactIds: conflictIds, action: 'move' });
    ok(moved.moved === 2, "'move' files them into Retail");
    await throws(() => seg.resolve({ segmentId: retail.id, contactIds: conflictIds, action: 'shrug' }),
      'an unknown action is refused');

    console.log('\nNobody is ever in two audiences');
    const { rows: dupes } = await pool.query(
      `SELECT contact_id, COUNT(*)::int AS n FROM outreach_campaign_contacts
        WHERE campaign_id = $1 GROUP BY contact_id HAVING COUNT(*) > 1`, [campaignId]);
    ok(dupes.length === 0, 'no contact has two membership rows on this campaign');
    const w = await seg.memberIds(work.id); const rt = await seg.memberIds(retail.id);
    ok(w.length === 2 && rt.length === 4, 'Workplace 2, Retail 4 after the move');
    ok(!w.some((id) => rt.includes(id)), 'the two audiences share nobody');

    console.log('\nCounts and suppression');
    const listed = await seg.list(campaignId);
    ok(listed.length === 2, 'both audiences listed');
    ok(listed.find((s) => s.name === 'Retail').member_count === 4, 'member count matches');
    await pool.query("UPDATE outreach_contacts SET status = 'do_not_contact' WHERE id = $1", [rt[0]]);
    const after = await seg.list(campaignId);
    ok(after.find((s) => s.name === 'Retail').suppressed_count === 1, 'a do-not-contact member is counted as suppressed');
    ok((await seg.memberIds(retail.id)).length === 3, 'and is left out of the sendable members');
    await pool.query("UPDATE outreach_contacts SET status = 'active' WHERE id = $1", [rt[0]]);

    console.log('\nPer-audience copy');
    await seg.update(work.id, {
      intro: 'Thought this might suit your workplace coverage.',
      subjects: { 1: 'Workplace: a new studio', 3: 'Following up on the studio' },
      followups: [{ subject: 'Quick nudge', body: 'Any interest?' }],
    });
    const copy = await seg.copyForContact(campaignId, w[0]);
    ok(copy && copy.name === 'Workplace', 'the sender resolves a contact to their audience');
    ok(copy.intro === 'Thought this might suit your workplace coverage.', 'the audience intro is returned');
    ok(copy.subjectFor(1) === 'Workplace: a new studio', 'a per-step subject override is returned');
    ok(copy.subjectFor(2) === null, 'a step with no override falls back (null)');
    ok(copy.followUpFor(2).subject === 'Quick nudge', 'step 2 maps to the first follow-up');
    ok(copy.followUpFor(3) === undefined || copy.followUpFor(3) === null, 'a missing follow-up is absent, not wrong');
    ok(copy.hasCopy === true, 'hasCopy is true once tailored');

    const plain = await seg.copyForContact(campaignId, rt[1]);
    ok(plain && plain.hasCopy === false, 'an untailored audience reports no copy, so the shared pitch is used');

    const { rows: unfiledSeed } = await pool.query(
      `INSERT INTO outreach_campaign_contacts (campaign_id, contact_id, segment_id)
       VALUES ($1, $2, NULL) ON CONFLICT (campaign_id, contact_id) DO UPDATE SET segment_id = NULL
       RETURNING contact_id`, [campaignId, contacts[5]]);
    ok((await seg.copyForContact(campaignId, unfiledSeed[0].contact_id)) === null,
      'a contact in no audience resolves to null, preserving old single-audience behaviour');
    ok((await seg.unassigned(campaignId)).length === 1, 'unfiled members are listed separately');

    console.log('\nLocking and freezing');
    await seg.setLocked(work.id, true);
    await throws(() => seg.assign({ segmentId: work.id, contactIds: [contacts[5]] }),
      'a locked audience refuses new members');
    await seg.setLocked(work.id, false);
    r = await seg.assign({ segmentId: work.id, contactIds: [contacts[5]] });
    ok(r.added === 1, 'unlocking lets members in again');

    await seg.markSent(work.id);
    await throws(() => seg.update(work.id, { intro: 'too late' }), 'a sent audience refuses copy edits');
    await throws(() => seg.assign({ segmentId: work.id, contactIds: [contacts[0]] }), 'a sent audience refuses new members');
    await throws(() => seg.remove(work.id), 'a sent audience cannot be deleted');
    const stillThere = await seg.memberIds(work.id);
    ok(stillThere.length === 3, 'its membership is intact after being frozen');
    // Moving someone OUT of a sent audience would misreport what they received.
    const outOfSent = await seg.resolve({ segmentId: retail.id, contactIds: [stillThere[0]], action: 'move' });
    ok(outOfSent.moved === 0, 'a member of a sent audience cannot be moved elsewhere');

    console.log('\nDeleting an unsent audience keeps its people on the campaign');
    // A contact who is in no audience yet, so assign() files them rather than
    // reporting a conflict. (Reusing one already in the sent Workplace audience
    // would be refused, correctly, and would not test deletion at all.)
    const { rows: fresh } = await pool.query(
      `INSERT INTO outreach_contacts (name, email, kind, status)
       VALUES ($1, $2, 'media', 'active') RETURNING id`,
      [`Seg Person spare`, `${SLUG}-spare@example.com`]);
    contacts.push(fresh[0].id);
    const spare = await seg.create({ campaignId, name: 'Spare' });
    const filed = await seg.assign({ segmentId: spare.id, contactIds: [fresh[0].id] });
    ok(filed.added === 1, 'a fresh contact files into the new audience');
    await seg.remove(spare.id);
    const { rows: still } = await pool.query(
      'SELECT segment_id FROM outreach_campaign_contacts WHERE campaign_id = $1 AND contact_id = $2',
      [campaignId, fresh[0].id]);
    ok(still.length === 1 && still[0].segment_id === null,
      'the member stays on the campaign, unfiled, rather than being dropped');
    console.log('\nThe preview and the test render the audience\u2019s copy');
    {
      const byId = await seg.copyForSegment(work.id);
      ok(byId && byId.name === 'Workplace', 'an audience\u2019s copy can be fetched by id, for previewing it directly');
      const base = { title: 'T', followups_ai: true, custom_release_body: 'shared pitch', custom_followups: [] };
      const over = seg.overlayRelease(base, byId);
      ok(over.custom_release_body === 'Thought this might suit your workplace coverage.',
        'the overlay puts the audience intro where the renderer looks for shared copy');
      ok(over.followups_ai === false,
        'and flips to the no-AI path, so a preview or test of a tailored audience costs nothing');
      ok(over.custom_followups[0].subject === 'Quick nudge', 'the audience follow-ups come through');
      ok(base.custom_release_body === 'shared pitch', 'the original release object is not mutated');

      const plainSeg = await seg.copyForSegment(retail.id);
      ok(seg.overlayRelease(base, plainSeg) === base,
        'an untailored audience returns the release untouched, so it sends the shared pitch');
      ok(seg.overlayRelease(base, null) === base, 'no audience at all returns the release untouched');

      const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'press.js'), 'utf8');
      // Both the preview and the test overlay; matching on a window between the
      // route name and the call is brittle (the handlers are long), so assert the
      // count and that each handler reads segment_id.
      ok((routes.match(/segments\.overlayRelease\(release, audienceCopy\)/g) || []).length === 2,
        'both the preview and the test routes overlay the audience copy');
      const handler = (name) => {
        const i = routes.indexOf(`router.post('/releases/:id/${name}'`);
        return i === -1 ? '' : routes.slice(i, routes.indexOf("\nrouter.", i + 10));
      };
      ok(/segment_id/.test(handler('preview')) && /overlayRelease/.test(handler('preview')),
        'the preview handler takes segment_id and overlays it');
      ok(/segment_id/.test(handler('test')) && /overlayRelease/.test(handler('test')),
        'the test handler takes segment_id and overlays it');
      const sender = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'outreachSender.js'), 'utf8');
      ok(/const cached = authorMode[\s\S]{0,200}getOrGenerateEmails/.test(sender),
        'sendPressTest renders shared copy instead of generating a per-recipient pitch (which showed an email nobody would receive, and billed for it)');
    }

    // The copy is only worth storing if the sender reads it. These assert the
    // wiring at each render point, because exercising sendPress end to end would
    // deliver real email.
    console.log('\nThe sender is wired to the audience copy');
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'outreachSender.js'), 'utf8');
      ok(/copyForContact\(campaignId, contact\.id\)/.test(src),
        'sendPress resolves the recipient to their audience');
      ok(/const authorMode = release\.followups_ai === false \|\| !!segIntro/.test(src),
        'an audience intro takes the no-AI shared-copy path (so a tailored send costs nothing per recipient)');
      ok(/const authorReleaseBody = authorMode \? \(segIntro \|\| release\.custom_release_body/.test(src),
        'the audience intro is preferred over the release-level body');
      ok(/const editedSubject = \(segCopy && segCopy\.subjectFor\(1\)\) \|\| seqRows/.test(src),
        "step 1's subject prefers the audience override, falling back to the shared sequence row");
      ok(/const stepSubject = \(segCopy && segCopy\.subjectFor\(stepNo\)\) \|\| stepRows/.test(src),
        "a follow-up's subject prefers the audience override");
      ok(/const c = segFollowUp \|\| customs\[followupIndex - 1\]/.test(src),
        "a follow-up's body prefers the audience's own");

      // Sequences must stay per campaign. If they ever gain a segment_id, the
      // send queue's CROSS JOIN hands every contact every audience's emails.
      const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'press.js'), 'utf8');
      const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', '191_press_audiences.sql'), 'utf8');
      // Comment lines stripped: the migration discusses outreach_sequences at
      // length to explain why it is NOT touched, so match the DDL only.
      const ddl = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      ok(!/outreach_sequences/.test(ddl),
        'migration 191 does not touch outreach_sequences at all');
      ok((routes.match(/CROSS JOIN outreach_sequences s/g) || []).length === 2,
        'both send paths use the same per-campaign sequence join');
    }
  } finally {
    await cleanup();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})();

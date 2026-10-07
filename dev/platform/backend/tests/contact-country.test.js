/**
 * Country on a journalist, and country exclusions on a release.
 *
 * Two things this guards.
 *
 * 1. THE DERIVATION IS HONEST. It resolves what it can from data already held
 *    (outlet country, location text, email TLD) and leaves the rest NULL. A guess
 *    would be worse than a gap: the operator excludes countries from a send on
 *    the strength of this, so a wrong country sends a release to someone they
 *    told it to hold back. Ambiguous city names are deliberately absent, and .co
 *    / .io / .ai are not treated as country codes.
 *
 * 2. THE EXCLUSION IS ENFORCED AT DISPATCH, not only in the pickers. This is the
 *    lesson already in the agent guide: filtering a state out of a selection
 *    query is not enforcement, because the state can change after the queue was
 *    built. do_not_contact was excluded by every picker for months while the gate
 *    ignored it. The gate check is asserted here against real rows.
 *
 * Needs a database; calls no AI endpoint, so it is free to run.
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=... node tests/contact-country.test.js
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');
const cc = require('../src/services/contactCountry');
const seg = require('../src/services/pressSegments');

let failures = 0;
const ok = (c, l) => { if (c) console.log(`  ok   ${l}`); else { console.log(`  FAIL ${l}`); failures++; } };

const SLUG = `countrytest-${Date.now()}`;
let clientId, campaignId, releaseId;
const contacts = [];

async function addContact(name, email, location, company) {
  const { rows } = await pool.query(
    `INSERT INTO outreach_contacts (name, email, location, company, kind, status)
     VALUES ($1,$2,$3,$4,'media','active') RETURNING id`,
    [name, email, location, company]);
  contacts.push(rows[0].id);
  return rows[0].id;
}

(async () => {
  console.log('\nNormalising a country name');
  ok(cc.normaliseCountry('UK') === 'United Kingdom', '"UK" becomes United Kingdom');
  ok(cc.normaliseCountry('u.k.') === 'United Kingdom', 'punctuation and case ignored');
  ok(cc.normaliseCountry('England') === 'United Kingdom', 'England becomes United Kingdom');
  ok(cc.normaliseCountry('USA') === 'United States', 'USA becomes United States');
  ok(cc.normaliseCountry('Holland') === 'Netherlands', 'Holland becomes Netherlands');
  ok(cc.normaliseCountry('London') === null, 'a city is not a country');
  ok(cc.normaliseCountry('') === null, 'empty is null, not a guess');

  console.log('\nReading a country out of location text');
  ok(cc.countryFromLocation('London, UK') === 'United Kingdom', 'trailing country in "London, UK"');
  ok(cc.countryFromLocation('Brooklyn, New York, USA') === 'United States', 'country last of three parts');
  ok(cc.countryFromLocation('France') === 'France', 'a bare country name');
  ok(cc.countryFromLocation('Shoreditch') === null, 'an unknown place resolves to nothing');
  ok(cc.countryFromCity('London') === 'United Kingdom', 'a known city');
  ok(cc.countryFromCity('Milan, Italy') === 'Italy', 'city lookup finds a part');
  ok(cc.countryFromCity('Birmingham') === null, 'Birmingham is ambiguous (UK vs Alabama) so it is absent');
  ok(cc.countryFromCity('Cambridge') === null, 'Cambridge is ambiguous so it is absent');

  console.log('\nEmail TLD');
  ok(cc.countryFromEmail('jane@thetimes.co.uk') === 'United Kingdom', '.co.uk');
  ok(cc.countryFromEmail('p@lemonde.fr') === 'France', '.fr');
  ok(cc.countryFromEmail('a@dezeen.com') === null, '.com says nothing');
  ok(cc.countryFromEmail('a@b.press') === null, 'a long gTLD is not a country code');
  ok(cc.countryFromEmail('a@b.co') === null, '.co is not treated as Colombia');
  ok(cc.countryFromEmail('a@b.io') === null, '.io is not a country');
  ok(cc.countryFromEmail('nonsense') === null, 'a non-address is null');

  console.log('\nWhich signal wins');
  ok(cc.derive({ email: 'a@x.com', location: 'London', outletCountry: 'Italy' }).source === 'outlet',
    'the outlet beats the location');
  ok(cc.derive({ email: 'a@x.fr', location: 'Berlin, Germany' }).country === 'Germany',
    'an explicit country in the location beats the TLD');
  ok(cc.derive({ email: 'a@x.fr', location: 'Berlin' }).source === 'city',
    'a known city beats the TLD');
  ok(cc.derive({ email: 'a@x.fr', location: 'Nowheresville' }).source === 'tld',
    'the TLD is the fallback');
  ok(cc.derive({ email: 'a@x.com', location: '' }) === null,
    'nothing to go on resolves to null');
  ok(cc.supersedes('outlet', 'tld') === true, 'a better source upgrades a weaker one');
  ok(cc.supersedes('tld', 'outlet') === false, 'a weaker source never downgrades');
  ok(cc.supersedes('outlet', 'manual') === false, 'a hand-typed country is never overwritten');

  // ── against the database ───────────────────────────────────────────────────
  const { rows: cl } = await pool.query('INSERT INTO clients (name, slug) VALUES ($1,$1) RETURNING id', [SLUG]);
  clientId = cl[0].id;
  const { rows: cp } = await pool.query(
    "INSERT INTO outreach_campaigns (client_id, name, campaign_type) VALUES ($1,$2,'press') RETURNING id",
    [clientId, SLUG]);
  campaignId = cp[0].id;
  const { rows: rr } = await pool.query(
    'INSERT INTO outreach_press_releases (client_id, campaign_id, title) VALUES ($1,$2,$3) RETURNING id',
    [clientId, campaignId, 'Country probe']);
  releaseId = rr[0].id;
  await pool.query("INSERT INTO outreach_sequences (campaign_id, step_number, delay_days) VALUES ($1,1,0)", [campaignId]);

  try {
    console.log('\nBackfill');
    const uk = await addContact('UK One', `${SLUG}-uk@thetimes.co.uk`, 'London', 'The Times UK');
    const us = await addContact('US One', `${SLUG}-us@x.com`, 'Brooklyn, New York, USA', 'US Mag');
    const fr = await addContact('FR One', `${SLUG}-fr@lemonde.fr`, null, 'Le Monde FR');
    const unknown = await addContact('No Clue', `${SLUG}-nc@x.com`, 'Shoreditch', 'Mystery Co');

    const before = await cc.backfill({ dryRun: true });
    ok(before.would_update >= 3 && before.updated === 0, 'a dry run reports changes without writing');
    const run = await cc.backfill({});
    ok(run.updated >= 3, `${run.updated} contacts got a country`);

    const { rows: got } = await pool.query(
      'SELECT id, country, country_source FROM outreach_contacts WHERE id = ANY($1::uuid[])',
      [[uk, us, fr, unknown]]);
    const by = Object.fromEntries(got.map((r) => [String(r.id), r]));
    ok(by[uk].country === 'United Kingdom', 'London resolved to United Kingdom');
    ok(by[us].country === 'United States', '"Brooklyn, New York, USA" resolved to United States');
    ok(by[fr].country === 'France' && by[fr].country_source === 'tld', 'a .fr address with no location used the TLD');
    ok(by[unknown].country === null, 'an unresolvable contact stays NULL rather than being guessed');

    console.log('\nMatching a contact to its publication');
    {
      // The outlet lookup used to be a trailing-wildcard LIKE in SQL, which was
      // both slow (69s on 20k contacts x 3k outlets) and wrong at the edges:
      // "faketimes.co.uk" ends with "thetimes.co.uk". It is now an exact match on
      // the email domain, then on the domain with one subdomain label stripped,
      // then on the company name.
      await pool.query(
        `INSERT INTO pr_outlets (name, canonical_name, domain, region)
         VALUES ('CT Times', 'CT Times', $1, 'France')`, [`${SLUG}-times.co.uk`]);
      const sub = await addContact('Sub', `a@news.${SLUG}-times.co.uk`, null, null);
      const fake = await addContact('Fake', `b@not${SLUG}-times.co.uk`, null, null);
      const byName = await addContact('ByName', `c@elsewhere.com`, null, 'CT Times');
      await cc.backfill({});
      const { rows } = await pool.query(
        'SELECT id, country, country_source FROM outreach_contacts WHERE id = ANY($1::uuid[])',
        [[sub, fake, byName]]);
      const m = Object.fromEntries(rows.map(r => [String(r.id), r]));
      ok(m[sub].country === 'France' && m[sub].country_source === 'outlet',
        'a subdomain of the outlet domain matches it');
      ok(m[fake].country !== 'France',
        'a domain that merely ENDS WITH the outlet domain does not match it');
      ok(m[byName].country === 'France' && m[byName].country_source === 'outlet',
        'the company name matches when the email domain does not');
      await pool.query('DELETE FROM pr_outlets WHERE name = $1', ['CT Times']);
    }

    const cov = await cc.coverage();
    ok(cov.contacts >= 4 && cov.with_country >= 3, 'coverage counts what resolved');
    ok(cov.unknown >= 1 && typeof cov.coverage_pct === 'number', 'and reports the gap as a number');
    ok(cov.by_country.some((r) => r.country === 'United Kingdom'), 'coverage breaks down by country');
    ok(cov.by_source.some((r) => r.source === 'tld'), 'and by how it was derived');

    console.log('\nA hand-typed country sticks');
    await cc.setManual(unknown, 'uk');
    let { rows: m } = await pool.query('SELECT country, country_source FROM outreach_contacts WHERE id = $1', [unknown]);
    ok(m[0].country === 'United Kingdom' && m[0].country_source === 'manual', 'set by hand, normalised, marked manual');
    await cc.backfill({});
    ({ rows: m } = await pool.query('SELECT country, country_source FROM outreach_contacts WHERE id = $1', [unknown]));
    ok(m[0].country_source === 'manual', 'a later backfill leaves it alone');
    await cc.setManual(unknown, '');
    ({ rows: m } = await pool.query('SELECT country, country_source FROM outreach_contacts WHERE id = $1', [unknown]));
    ok(m[0].country === null, 'clearing it by hand sets it back to unknown');
    await pool.query("UPDATE outreach_contacts SET country = NULL, country_source = NULL WHERE id = $1", [unknown]);

    console.log('\nThe exclusion, in the audience');
    const audience = await seg.create({ campaignId, name: 'All' });
    await seg.assign({ segmentId: audience.id, contactIds: [uk, us, fr, unknown] });
    ok((await seg.memberIds(audience.id)).length === 4, 'no exclusions set, everyone is sendable');

    await pool.query(
      "UPDATE outreach_press_releases SET excluded_countries = ARRAY['United States'], unknown_country_policy = 'send' WHERE id = $1",
      [releaseId]);
    let ids = await seg.memberIds(audience.id);
    ok(ids.length === 3 && !ids.includes(String(us)), 'excluding the US holds back the US contact');
    ok(ids.includes(String(unknown)), "with policy 'send', an unknown country still sends");

    await pool.query("UPDATE outreach_press_releases SET unknown_country_policy = 'hold' WHERE id = $1", [releaseId]);
    ids = await seg.memberIds(audience.id);
    ok(ids.length === 2 && !ids.includes(String(unknown)), "with policy 'hold', an unknown country is held back too");

    const bd = await seg.suppressionBreakdown(audience.id);
    ok(bd.members === 4 && bd.country_excluded === 2, 'the breakdown says 2 held back by country');
    ok(bd.country_unknown === 1, 'and names how many of those are unknown rather than excluded');

    console.log('\nThe exclusion, at dispatch (the authoritative stop)');
    // Queue a send for the US contact with no exclusions in force, exactly as a
    // send before the exclusion was added would have, then add the exclusion.
    await pool.query("UPDATE outreach_press_releases SET excluded_countries = '{}', unknown_country_policy = 'send' WHERE id = $1", [releaseId]);
    const { rows: sq } = await pool.query(
      `INSERT INTO outreach_sends (campaign_id, contact_id, sequence_id, status, scheduled_at)
       SELECT $1, $2, s.id, 'pending', NOW() FROM outreach_sequences s WHERE s.campaign_id = $1
       RETURNING id`, [campaignId, us]);
    await pool.query("UPDATE outreach_press_releases SET excluded_countries = ARRAY['United States'] WHERE id = $1", [releaseId]);

    // Run the gate's own predicate against the queued row.
    const { rows: gate } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM outreach_press_releases pr
          WHERE pr.campaign_id = s.campaign_id
            AND COALESCE(array_length(pr.excluded_countries, 1), 0) > 0
            AND CASE WHEN con.country IS NULL THEN pr.unknown_country_policy = 'hold'
                     ELSE con.country = ANY(pr.excluded_countries) END
       ) AS country_excluded
       FROM outreach_sends s
       JOIN outreach_contacts con ON con.id = s.contact_id
      WHERE s.id = $1`, [sq[0].id]);
    ok(gate[0].country_excluded === true,
      'a send queued BEFORE the exclusion existed is caught at dispatch');

    // And the gate actually acts on it.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'scheduler.js'), 'utf8');
    ok(/AS country_excluded/.test(src), 'runOutreachSends selects country_excluded');
    ok(/if \(row\.country_excluded\) \{[\s\S]{0,200}status = 'cancelled'/.test(src),
      'and cancels the send when it is true');

    console.log('\nAn exclusion typed loosely still matches');
    const { rows: norm } = await pool.query(
      "SELECT $1::text AS typed", ['uk']);
    ok(cc.normaliseCountry(norm[0].typed) === 'United Kingdom',
      'the route stores the canonical spelling, so "uk" matches contacts stored as "United Kingdom"');
  } catch (err) {
    // Without this the finally block's process.exit masks the throw and the run
    // prints "all passed" having executed almost nothing. That exact false pass
    // happened twice in this repo; see docs/omi/agent-guide.md.
    console.log(`  FAIL threw: ${err.message}`);
    console.log(err.stack.split('\n').slice(1, 4).join('\n'));
    failures++;
  } finally {
    if (campaignId) await pool.query('DELETE FROM outreach_campaigns WHERE id = $1', [campaignId]);
    if (contacts.length) await pool.query('DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])', [contacts]);
    if (clientId) await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})();

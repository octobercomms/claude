// Worked examples, one per pillar, for a client that has just been set up.
//
// Paid has had one since October: a real batch drawn from the client's own
// profile and badged "Example", so a brand-new client has something that runs
// through every Build step and can be shown to a client without being taken
// for approved work. Shared, Earned and Owned had nothing, so a newly set-up
// client opened three empty pages and had to imagine what each one produced.
//
// Three rules this follows, each learned the hard way:
//
// **Idempotent.** A second click returns what the first made. The account
// lead cannot tell by looking whether the button has been pressed, so pressing
// it twice must not cost twice or leave two examples to tell apart.
//
// **Badged, always.** An example that cannot be distinguished from real work
// is worse than no example, because somebody eventually sends it to a client.
// Every row carries `is_example`, and every list that shows it says so.
//
// **Never silent about failure.** One pillar failing must not take the others
// with it, and must not be reported as success. Each pillar returns its own
// outcome and the caller shows all four.
//
// The flag is set by updating the row the existing generator created rather
// than threading an `isExample` argument through three services. That keeps
// the normal, every-day path of each generator untouched: a change there to
// serve a setup button would be risk taken in the wrong place.

const pool = require('../db');
const adCreative = require('./adCreative');
const social = require('./social');
const contentDraft = require('./contentDraft');
const prPress = require('./prPress');

// The briefs are deliberately generic and say what they are. An example that
// reads like a real campaign is one somebody will try to run.
const EXAMPLE_BRIEF = {
  shared: 'A worked example for the team to look at. Introduce what this brand does and who it is for, in the brand\'s own voice, using the profile and brand assets on file. No offer, no discount, no dated claim.',
  owned: 'A worked example for the team to look at. Write a short, useful article on a subject this brand is credible on, drawn from its profile and brand assets. No offer, no discount, no dated claim.',
  earned: 'A worked example for the team to look at, showing the shape of a release for this brand. Use the profile on file. Mark anything that would need real facts in square brackets.',
};

// Each pillar's example, so the orchestration below is one shape four times.
// `find` answers "is there one already", `make` builds one.
const PILLARS = {
  paid: {
    label: 'Paid',
    what: 'a batch of ad concepts',
    async find(clientId) {
      const { rows } = await pool.query(
        'SELECT id FROM ad_creative_batches WHERE client_id = $1 AND is_example LIMIT 1', [clientId]);
      return rows[0] || null;
    },
    async make(clientId) {
      // Paid's own helper is already idempotent and already sets the flag.
      const { batch } = await adCreative.ensureExampleBatch({ clientId });
      return { id: batch.id };
    },
  },

  shared: {
    label: 'Shared',
    what: 'a batch of social posts',
    async find(clientId) {
      const { rows } = await pool.query(
        'SELECT id FROM social_batches WHERE client_id = $1 AND is_example LIMIT 1', [clientId]);
      return rows[0] || null;
    },
    async make(clientId) {
      // Three posts, not nine: an example exists to show the shape of the
      // output, and nine of them is a month's content nobody asked for.
      const { batch } = await social.generateBatch({
        clientId,
        brief: EXAMPLE_BRIEF.shared,
        platforms: ['instagram'],
        count: 3,
        length: 'medium',
      });
      await pool.query('UPDATE social_batches SET is_example = true WHERE id = $1', [batch.id]);
      return { id: batch.id };
    },
  },

  owned: {
    label: 'Owned',
    what: 'a drafted article',
    async find(clientId) {
      const { rows } = await pool.query(
        'SELECT id FROM content_drafts WHERE client_id = $1 AND is_example LIMIT 1', [clientId]);
      return rows[0] || null;
    },
    async make(clientId) {
      const draft = await contentDraft.generateDraft({
        clientId,
        brief: EXAMPLE_BRIEF.owned,
        targetKeyword: null,
      });
      await pool.query('UPDATE content_drafts SET is_example = true WHERE id = $1', [draft.id]);
      return { id: draft.id };
    },
  },

  earned: {
    label: 'Earned',
    what: 'a drafted press release',
    async find(clientId) {
      const { rows } = await pool.query(
        'SELECT id FROM pr_press_releases WHERE client_id = $1 AND is_example LIMIT 1', [clientId]);
      return rows[0] || null;
    },
    async make(clientId) {
      const { rows } = await pool.query('SELECT name FROM clients WHERE id = $1', [clientId]);
      const name = rows[0]?.name || 'this client';
      const title = `Example release — ${name}`;
      const { rows: created } = await pool.query(
        `INSERT INTO pr_press_releases (client_id, title, brand, angle, key_facts, is_example)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [clientId, title.slice(0, 500), name.slice(0, 120), EXAMPLE_BRIEF.earned, '']
      );
      const release = created[0];
      // The body is a second call and is allowed to fail on its own: a
      // release row with no body is still a usable example of the form, and
      // deleting it on a draft failure would lose the title and angle too.
      try {
        const drafted = await prPress.draftBody({
          title, client: name, angle: EXAMPLE_BRIEF.earned, key_facts: '',
        });
        if (drafted && drafted.body_html) {
          await pool.query('UPDATE pr_press_releases SET body_html = $1 WHERE id = $2',
            [drafted.body_html, release.id]);
        }
      } catch (err) {
        console.warn('[worked-examples] earned body draft failed (row kept):', err.message);
      }
      return { id: release.id };
    },
  },
};

const KEYS = Object.keys(PILLARS);

// One pillar. Returns { pillar, label, what, status, id?, error? } where
// status is 'existed' | 'created' | 'failed'.
//
// `registry` is injectable so the orchestration can be tested without a
// database or four Claude calls. The behaviour worth guarding is not what any
// one generator writes; it is that a second press makes nothing twice, and
// that one pillar failing neither stops the others nor gets reported as
// success. Both are invisible until the day they are wrong on a real client.
async function ensureOne(clientId, key, registry = PILLARS) {
  const p = registry[key];
  if (!p) return { pillar: key, status: 'failed', error: `Unknown pillar: ${key}` };
  const base = { pillar: key, label: p.label, what: p.what };
  try {
    const found = await p.find(clientId);
    if (found) return { ...base, status: 'existed', id: found.id };
    const made = await p.make(clientId);
    return { ...base, status: 'created', id: made.id };
  } catch (err) {
    console.error(`[worked-examples] ${key} failed:`, err.message);
    return { ...base, status: 'failed', error: err.message };
  }
}

// All four. Sequential rather than parallel: four Claude calls at once on a
// shared key is a rate-limit waiting to happen, and this runs once per client
// behind a button, where a few extra seconds costs nothing.
async function ensureAll(clientId, { pillars, registry = PILLARS } = {}) {
  const keys = Object.keys(registry);
  const wanted = (pillars || keys).filter(k => keys.includes(k));
  const results = [];
  for (const key of wanted) results.push(await ensureOne(clientId, key, registry));
  return {
    results,
    created: results.filter(r => r.status === 'created').length,
    existed: results.filter(r => r.status === 'existed').length,
    failed: results.filter(r => r.status === 'failed').length,
  };
}

// What already exists, without making anything. The Setup panel reads this so
// the button can say what it would do before it is pressed.
async function status(clientId, { registry = PILLARS } = {}) {
  const results = [];
  for (const key of Object.keys(registry)) {
    const p = registry[key];
    try {
      const found = await p.find(clientId);
      results.push({ pillar: key, label: p.label, what: p.what, present: !!found, id: found?.id || null });
    } catch (err) {
      results.push({ pillar: key, label: p.label, what: p.what, present: false, error: err.message });
    }
  }
  return { results, missing: results.filter(r => !r.present).length };
}

module.exports = { ensureAll, ensureOne, status, PILLARS, PILLAR_KEYS: KEYS };

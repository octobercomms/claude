// The October bid profile — a single markdown doc (id = 1) that every bid
// workspace reads, so learning compounds across bids. The account lead edits it,
// and the agent is told it may suggest additions (won/lost notes, reusable
// boilerplate) which the lead pastes in.

const pool = require('../../db');

async function get() {
  const { rows } = await pool.query('SELECT profile_md, updated_at FROM tender_org_profile WHERE id = 1');
  return rows[0] || { profile_md: '', updated_at: null };
}

async function set(profileMd) {
  const md = typeof profileMd === 'string' ? profileMd : '';
  const { rows } = await pool.query(
    `INSERT INTO tender_org_profile (id, profile_md, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET profile_md = EXCLUDED.profile_md, updated_at = NOW()
     RETURNING profile_md, updated_at`,
    [md]
  );
  return rows[0];
}

// Append a learned snippet to the profile (used by "Learn from this bid").
async function append(snippet) {
  const s = (snippet || '').trim();
  if (!s) return get();
  const cur = (await get()).profile_md || '';
  return set(cur ? `${cur}\n\n${s}` : s);
}

module.exports = { get, set, append };

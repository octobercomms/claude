// One list of journalists for one story, from both matchers.
//
// Earned → Match had two cards asking the same question — "who do I send this
// to" — with two boxes to paste the same release into. Daniel: "this is kinda
// the same thing right? ... can it provide a combined list though?"
//
// They are two genuinely different engines, and that is worth keeping:
//
//   prTarget        reads the release with Claude, extracts an angle, then
//                   ranks a SQL-shortlisted pool and writes a reason for each
//                   pick. Costs a few cents. Includes contacts with no email,
//                   flagged. Can take a URL.
//
//   journalistMatch ranks the WHOLE contact database by what journalists
//                   actually publish — embeddings when an OpenAI key is set,
//                   otherwise keyword and recency. Free, deterministic.
//                   Requires a working email, so it never returns the rest.
//
// What makes the pair worth more than either: when an LLM that has read the
// release and a ranking over every contact independently pick the same
// journalist, that agreement is the strongest signal on the page. Neither
// engine can produce it alone.
//
// Both run against ONE resolved story text. Fetching a URL twice would mean
// two requests to the client's newsroom for one click and two engines ranking
// against two different scrapes of the same page.

const prTarget = require('./prTarget');
const journalistMatch = require('./journalistMatch');

// The list is sorted by fit, descending. Agreement is a tie-break inside a
// score, never a band above it.
//
// The first version of this ranked agreement first, on the reasoning that two
// engines picking the same journalist independently is the strongest signal
// available. The independence is not there. journalistEmbed embeds
// beats + topics + auto_topics + enrichment_note + recent article titles, and
// prTarget's candidate pool is a LIKE over enrichment_note, beats, topics and
// outlet name with the same fields sent to Claude. Both read the same columns,
// so agreement says the beats data is consistent with itself — and where a
// contact's beats are stale, both engines are wrong together and the ranking
// promotes the error to the top of the page.
//
// The negative case is worse than useless. Claude is asked for "the best up to
// 15" of 40 candidates, so a row it did not return may have been judged wrong
// for the story, may have been sixteenth, or may never have reached the
// shortlist. Ranking on agreement ranks partly on where that cut happened to
// fall.
//
// It is still worth surfacing: `agreed` travels on each row so the screen can
// preselect those rows for a shortlist, where it is a visible suggestion the
// operator can override rather than a hidden term in a score.
function compareRows(a, b) {
  const fa = a.fit == null ? -1 : a.fit;
  const fb = b.fit == null ? -1 : b.fit;
  if (fa !== fb) return fb - fa;
  if (a.agreed !== b.agreed) return a.agreed ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

// An email we hold but cannot use is not an email. The import placeholder is
// the one that bites: it looks like an address and bounces every time.
function usableEmail(email) {
  return !!(email && !/@import\.local$/i.test(email));
}

/**
 * @param {object}   a
 * @param {string}   a.clientId
 * @param {string}  [a.url]              press release URL
 * @param {string}  [a.brief]            or the story as text
 * @param {Array}   [a.visibleClientIds] null for admin; scopes the free pass
 * @param {number}  [a.limit]
 * @returns {Promise<{angle, terms, mode, items, degraded}>}
 */
async function combined({ clientId, url, brief, visibleClientIds = null, limit = 40 }) {
  const text = await prTarget.resolveText({ url, brief });

  // Side by side, and settled rather than all: one engine being down must
  // not empty a list the other could fill. A Claude outage should cost the
  // reasons, not the contacts.
  const [reasoned, ranked] = await Promise.allSettled([
    prTarget.findTargets({ clientId, brief: text, visibleClientIds }),
    journalistMatch.matchForText(text, { clientId, visibleClientIds, limit }),
  ]);

  const degraded = [];
  const byId = new Map();

  // The free pass first: it carries the addresses and the fit score.
  let terms = [];
  let mode = null;
  if (ranked.status === 'fulfilled') {
    terms = ranked.value.terms || [];
    mode = ranked.value.mode || null;
    for (const m of ranked.value.items || []) {
      byId.set(m.id, {
        id: m.id,
        name: m.name,
        email: m.email || '',
        verification_status: m.verification_status || null,
        outlet: m.outlet || '',
        tier: m.tier || '',
        fit: m.fit != null ? m.fit : null,
        matched: m.matched || [],
        covered_client: !!m.covered_client,
        has_email: usableEmail(m.email),
        reason: '',
        sources: ['ranked'],
      });
    }
  } else {
    degraded.push({ engine: 'ranked', message: ranked.reason?.message || 'The whole-database ranking failed.' });
  }

  // Then Claude's picks, merged onto the same contact where they agree.
  let angle = '';
  if (reasoned.status === 'fulfilled' && !reasoned.value.error) {
    angle = reasoned.value.angle || '';
    for (const t of reasoned.value.targets || []) {
      const existing = byId.get(t.id);
      if (existing) {
        existing.sources.push('reasoned');
        existing.reason = t.reason || existing.reason;
        // The free pass does not know about prior coverage of this client in
        // the editorial log; this one counts it.
        existing.published_for_client = t.published_for_client || 0;
        if (!existing.email && t.email) existing.email = t.email;
        existing.strength_label = t.strength_label || null;
        if (!existing.outlet) existing.outlet = t.outlet || '';
        if (!existing.tier) existing.tier = t.tier || '';
        continue;
      }
      byId.set(t.id, {
        id: t.id,
        name: t.name,
        email: t.email || '',
        verification_status: t.verification_status || null,
        outlet: t.outlet || '',
        tier: t.tier || '',
        fit: null,                       // and does not score; it ranks by order
        matched: [],
        covered_client: (t.published_for_client || 0) > 0,
        has_email: !!t.has_email,
        reason: t.reason || '',
        published_for_client: t.published_for_client || 0,
        strength_label: t.strength_label || null,
        sources: ['reasoned'],
      });
    }
  } else if (reasoned.status === 'rejected') {
    degraded.push({ engine: 'reasoned', message: reasoned.reason?.message || 'The targeting pass failed.' });
  } else if (reasoned.value?.error) {
    degraded.push({ engine: 'reasoned', message: reasoned.value.error });
  }

  const all = [...byId.values()].map(r => ({ ...r, agreed: r.sources.length > 1 }));

  // The cap applies to the scored rows, and the unscored Claude picks are
  // appended after it rather than competing for the same slots.
  //
  // Sorting everything together and slicing deleted them outright: the free
  // pass is asked for `limit` rows and returns that many on any populated
  // database, so the cut landed exactly on the rows only Claude found —
  // overwhelmingly the contacts with no address, which the free pass cannot
  // return at all. The merge existed to stop those disappearing and instead
  // made it certain. A name a model explicitly put forward for this story is
  // never dropped to make room; worst case the table is a little longer than
  // asked for.
  const scored = all.filter(r => r.fit != null).sort(compareRows).slice(0, limit);
  const unscored = all.filter(r => r.fit == null).sort(compareRows);
  const items = [...scored, ...unscored];

  return { angle, terms, mode, items, degraded };
}

module.exports = { combined, _internals: { compareRows, usableEmail } };

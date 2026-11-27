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

// Where a row came from, worst to best. Agreement first, then the engine that
// scored it, then the one that reasoned about it.
//
// A Claude-only row is usually a contact the free pass could not return at
// all — no email on file, or not yet embedded — so it sits last rather than
// being dropped. At a title that matters, a journalist you have no address
// for is still worth knowing you should find one.
const RANK = { both: 0, ranked: 1, reasoned: 2 };

function sourceKey(sources) {
  if (sources.length > 1) return 'both';
  return sources[0] === 'ranked' ? 'ranked' : 'reasoned';
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
    prTarget.findTargets({ clientId, brief: text }),
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
        existing.strength_label = t.strength_label || null;
        if (!existing.outlet) existing.outlet = t.outlet || '';
        if (!existing.tier) existing.tier = t.tier || '';
        continue;
      }
      byId.set(t.id, {
        id: t.id,
        name: t.name,
        email: '',                       // this engine does not return the address
        verification_status: null,
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

  const items = [...byId.values()]
    .map(r => ({ ...r, agreed: r.sources.length > 1 }))
    .sort((a, b) => {
      const ra = RANK[sourceKey(a.sources)];
      const rb = RANK[sourceKey(b.sources)];
      if (ra !== rb) return ra - rb;
      // Within a band, the score when there is one. A missing fit sorts last
      // rather than as zero, so a Claude-only row never reads as a 0% fit.
      const fa = a.fit == null ? -1 : a.fit;
      const fb = b.fit == null ? -1 : b.fit;
      if (fa !== fb) return fb - fa;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, limit);

  return { angle, terms, mode, items, degraded };
}

module.exports = { combined, _internals: { sourceKey, usableEmail, RANK } };

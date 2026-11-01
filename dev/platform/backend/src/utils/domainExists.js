// Does this domain exist at all?
//
// On 1 November four of the nine Setup scans failed for one client, and the
// screen reported four separate failures with four different messages. The
// cause was one thing none of them said: morrowcomms.com has no DNS record.
// Nothing was wrong with the scans. They were each asked to fetch a site that
// is not on the internet, and each reported that in its own vocabulary.
//
// Worse, the domain had been chosen for the client automatically, so nobody
// had ever typed it and nobody had reason to doubt it.
//
// This answers the question once, before the work starts.
//
// FAIL OPEN. A DNS answer is only trusted when it is definitive. NXDOMAIN and
// NODATA mean the name is not there; a timeout, a refused query, a server
// failure or a missing resolver mean we do not know, and "we do not know" must
// never block a client whose site is fine. A false negative here would turn a
// DNS blip into "your website does not exist", which is a far worse failure
// than letting a dead domain through to the error it was going to produce
// anyway.

const dns = require('node:dns').promises;

// Definitive "this name does not resolve" codes. Everything else is unknown.
const ABSENT = new Set(['ENOTFOUND', 'ENODATA']);

// A control, because ENOTFOUND is ambiguous.
//
// A host with no working resolver answers ENOTFOUND for every name, which is
// byte-for-byte what a genuinely dead domain answers. Writing this check in a
// sandbox proved the point immediately: google.com read as "no DNS record".
// Shipping that would have told clients with perfectly good websites that
// their domain does not exist, which is the exact failure this file's header
// says must never happen.
//
// So a negative is only believed when a name that certainly exists resolves
// from the same host at the same time. If the control fails too, the resolver
// is the problem and every answer is "unknown".
const CONTROLS = ['cloudflare.com', 'icann.org'];
let controlCache = null;   // { ok: boolean, at: number }
const CONTROL_TTL_MS = 5 * 60 * 1000;

async function resolverWorks(timeoutMs) {
  if (controlCache && Date.now() - controlCache.at < CONTROL_TTL_MS) return controlCache.ok;
  let ok = false;
  for (const name of CONTROLS) {
    try {
      await Promise.race([
        dns.resolve4(name),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      ok = true; break;
    } catch { /* try the next control */ }
  }
  controlCache = { ok, at: Date.now() };
  return ok;
}

// Exposed so a test can force the next check to re-probe.
function _resetControlCache() { controlCache = null; }

function hostOf(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.replace(/\.$/, '') || null;
  } catch { return null; }
}

/**
 * @returns {Promise<{ host: string|null, exists: boolean, known: boolean, reason: string }>}
 *   exists  — there is an address record (or we could not tell; see known)
 *   known   — the answer is definitive. false means the check was inconclusive
 *             and the caller should carry on as if the domain were fine.
 */
async function domainExists(input, { timeoutMs = 3000 } = {}) {
  const host = hostOf(input);
  if (!host) return { host: null, exists: false, known: true, reason: 'not a domain' };
  // A bare label ("localhost", a typo with no dot) is not a public domain.
  if (!host.includes('.')) return { host, exists: false, known: true, reason: 'no top-level domain' };

  const lookup = dns.resolve4(host)
    .catch(() => dns.resolve6(host))
    // A site can live behind a CNAME with no direct A record in some
    // resolvers; a CNAME still means the name exists.
    .catch(async (err) => { await dns.resolveCname(host); throw err; });

  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs); });

  try {
    await Promise.race([lookup, timeout]);
    return { host, exists: true, known: true, reason: 'resolves' };
  } catch (err) {
    if (ABSENT.has(err?.code)) {
      // Believe it only if the resolver can still find something that exists.
      if (!(await resolverWorks(timeoutMs))) {
        return { host, exists: true, known: false, reason: 'could not check (no working resolver)' };
      }
      return { host, exists: false, known: true, reason: 'no DNS record' };
    }
    // Unknown: a timeout, SERVFAIL, REFUSED, no resolver configured.
    return { host, exists: true, known: false, reason: `could not check (${err?.code || err?.message || 'unknown'})` };
  } finally { clearTimeout(timer); }
}

module.exports = { domainExists, hostOf, _resetControlCache };

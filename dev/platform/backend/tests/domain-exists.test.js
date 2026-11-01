// A domain that does not exist, named once instead of four times.
//
// Four of the nine Setup scans failed for one client, each reporting it in
// its own vocabulary. The cause was a thing none of them said: the domain on
// that client has no DNS record. It had also been chosen for the client
// automatically, so nobody had typed it and nobody had reason to doubt it.
//
// The dangerous part of fixing this is the fix itself. ENOTFOUND means "that
// name is not there" and it also means "this machine has no working
// resolver", and the two are indistinguishable from the error alone. Writing
// this check proved it immediately: in a sandbox with DNS blocked,
// google.com read as "no DNS record". Shipping that would have told clients
// with perfectly good websites that their domain does not exist.
//
// So a negative is believed only when a control name that certainly exists
// resolves from the same host at the same moment.

const assert = require('assert');
const path = require('path');
const { domainExists, hostOf, _resetControlCache } = require('../src/utils/domainExists');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };
const okAsync = async (what, fn) => { await fn(); passed += 1; void what; };

ok('a host is read out of whatever shape the record holds', () => {
  assert.strictEqual(hostOf('morrowcomms.com'), 'morrowcomms.com');
  assert.strictEqual(hostOf('https://www.example.co.uk/a/b?c=1'), 'www.example.co.uk');
  assert.strictEqual(hostOf('  EXAMPLE.com '), 'example.com');
  assert.strictEqual(hostOf('example.com.'), 'example.com', 'a trailing dot is still that host');
  assert.strictEqual(hostOf(''), null);
  assert.strictEqual(hostOf(null), null);
  assert.strictEqual(hostOf('   '), null);
});

(async () => {
  await okAsync('the answers that need no DNS are definitive', async () => {
    // These are decided by shape, so they hold on any machine, resolver or
    // not — which is what makes them safe to act on.
    for (const [input, reason] of [['', 'not a domain'], ['   ', 'not a domain'], ['localhost', 'no top-level domain']]) {
      const r = await domainExists(input);
      assert.strictEqual(r.exists, false, `${JSON.stringify(input)} does not exist`);
      assert.strictEqual(r.known, true, `${JSON.stringify(input)} is a definitive answer`);
      assert.strictEqual(r.reason, reason);
    }
  });

  await okAsync('a lookup never blocks for longer than it is given', async () => {
    const started = Date.now();
    await domainExists('a-name-that-will-not-resolve-' + Date.now() + '.invalid', { timeoutMs: 400 });
    // Generous, because the control probe may run too. The point is that it
    // returns rather than hanging the catalogue request behind it.
    assert.ok(Date.now() - started < 4000, 'it returned');
  });

  await okAsync('an unknown answer says so, and says the domain exists', async () => {
    // The whole safety property: when the check cannot tell, it must not
    // accuse. `exists: true, known: false` is how callers are kept quiet.
    _resetControlCache();
    const r = await domainExists('example.com', { timeoutMs: 300 });
    if (!r.known) {
      assert.strictEqual(r.exists, true, 'an inconclusive check reports the domain as fine');
      assert.ok(/could not check/.test(r.reason), 'and says why');
    } else {
      // A machine with real DNS: example.com is a reserved name that resolves.
      assert.strictEqual(r.exists, true, 'example.com resolves');
    }
  });

  ok('the caller treats unknown as fine, everywhere it is used', () => {
    const fs = require('fs');
    const scans = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'setupScans.js'), 'utf8');
    const comps = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientCompetitors.js'), 'utf8');
    // Both read `known && !exists`. Reading `!exists` alone would turn a
    // broken resolver into "every client's website is gone".
    assert.ok(/const domainDead = dns\.known && !dns\.exists;/.test(scans),
      'the scan picker only acts on a definitive negative');
    assert.ok(/keep: !\(r\.known && !r\.exists\)/.test(comps),
      'and a suggestion is only dropped on a definitive negative');
    // And a thrown check must not take the request with it.
    assert.ok(/\.catch\(\(\) => \(\{ exists: true, known: false/.test(scans), 'a failed check falls back to fine');
    assert.ok(/\.catch\(\(\) => \(\{ exists: true, known: false \}\)\)/.test(comps), 'same for suggestions');
  });

  ok('the picker explains it once, above the list', () => {
    const fs = require('fs');
    const panel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'SetupScansPanel.jsx'), 'utf8');
    assert.ok(/data\?\.domain_check && !data\.domain_check\.ok/.test(panel), 'shown only on a definitive negative');
    assert.ok(/has no DNS record/.test(panel), 'and says what is wrong');
    const scans = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'setupScans.js'), 'utf8');
    assert.ok(/domain_check: \{ ok: !domainDead, checked: dns\.known, reason: dns\.reason \}/.test(scans),
      'the route sends it');
  });

  ok('"not set" and "set but dead" stay different sentences', () => {
    const fs = require('fs');
    const scans = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'setupScans.js'), 'utf8');
    assert.ok(/domain_dead: /.test(scans), 'there is a separate need for a dead domain');
    assert.ok(/else if \(need === 'domain' && domainDead\) out\.push\('domain_dead'\);/.test(scans),
      'and it is an else, so a client with no domain is not told both');
  });

  console.log(`${passed} guards`);
  console.log('---');
  console.log('A DEAD DOMAIN IS NAMED, A BROKEN RESOLVER IS NOT BELIEVED');
})();

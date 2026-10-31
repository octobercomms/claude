#!/usr/bin/env node
// Is the production dependency tree free of known-vulnerable packages?
//
//   node scripts/audit-check.js          # fails on any high or critical
//   node scripts/audit-check.js --all    # also report the dev tree, never fails on it
//
// `npm audit` alone is not a gate: it exits non-zero on anything, dev-only
// noise included, and it counts a package once per advisory so one bad
// transitive dependency can read as fifty findings. This answers the only
// question that matters for the box — what ships under `npm install --omit=dev`
// — and says what to do rather than printing a number.
//
// It deliberately has no allowlist. The production tree is at zero, and the
// moment something is permanently excused here, the check stops meaning
// anything. If a finding genuinely cannot be fixed, that belongs in
// docs/omi/dependency-audit.md as a stated decision with a date, and this
// check goes red until someone makes it.

const { execFileSync } = require('child_process');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const FAIL_AT = ['critical', 'high'];

function audit(omitDev) {
  const args = ['audit', '--json', ...(omitDev ? ['--omit=dev'] : [])];
  let out;
  try {
    out = execFileSync('npm', args, { cwd: BACKEND, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still
    // on stdout, and that is what we are here to read.
    out = e.stdout;
    if (!out) throw new Error(`npm audit produced no output: ${e.message}`);
  }
  return JSON.parse(out);
}

function summarise(report) {
  const counts = (report.metadata && report.metadata.vulnerabilities) || {};
  const blocking = [];
  for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
    if (!FAIL_AT.includes(v.severity)) continue;
    const titles = (v.via || []).filter(x => typeof x === 'object').map(x => x.title);
    const fix = v.fixAvailable;
    blocking.push({
      name,
      severity: v.severity,
      title: titles[0] || '(transitive)',
      fix: fix === true ? 'npm audit fix'
        : fix && fix.name ? `${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (MAJOR — check the API before taking it)' : ''}`
          : 'none published',
    });
  }
  return { counts, blocking };
}

function line(c) {
  return ['critical', 'high', 'moderate', 'low']
    .map(k => `${k} ${c[k] || 0}`).join(', ');
}

function main() {
  const all = process.argv.includes('--all');

  const prod = summarise(audit(true));
  console.log('\nproduction tree (what `npm install --omit=dev` puts on the box)');
  console.log(`  ${line(prod.counts)}\n`);

  for (const b of prod.blocking) {
    console.log(`  ${b.severity.toUpperCase().padEnd(8)} ${b.name}`);
    console.log(`           ${b.title.slice(0, 100)}`);
    console.log(`           fix: ${b.fix}`);
  }

  if (all) {
    const dev = summarise(audit(false));
    console.log('\nwhole tree, dev included (never fails this check: dev packages');
    console.log('are not installed on the box)');
    console.log(`  ${line(dev.counts)}`);
  }

  if (prod.blocking.length) {
    console.log(`\n${prod.blocking.length} high or critical finding(s) in the production tree.`);
    console.log('Start with `npm audit fix` (never --force: its "fix" is sometimes a');
    console.log('downgrade that breaks the API you call). Where a fix needs a major');
    console.log('bump, upgrade it deliberately and exercise the code that uses it.');
    console.log('See docs/omi/dependency-audit.md.');
    process.exit(1);
  }

  console.log('\nNo high or critical findings in the production tree.');
}

module.exports = { summarise, FAIL_AT };

if (require.main === module) main();

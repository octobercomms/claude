/**
 * Guard: every unattended loop that bills Anthropic directly must check its
 * task budget.
 *
 * This exists because it happened twice. callClaude enforces the global cap,
 * but a service that calls the Anthropic SDK directly (needed for the
 * web_search tool, which callClaude does not expose) is invisible to it, and
 * also invisible to the per-task budget and the Pause switch. Such a service
 * still RECORDS its spend, so the Settings screen reads "stopped — budget
 * used" while the job carries on spending.
 *
 * outletResolve did exactly that: 150 outlets a night at ~2.3c each turned a
 * $10 monthly budget into $20.75 of spend with nothing able to stop it.
 *
 * Run: node tests/budget-gating.test.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Services the scheduler drives unattended. A human never sees these run, so
// nothing bounds them except a budget check. Add a service here when you put
// it on a cron; the test then insists it is gated.
const CRON_DRIVEN = [
  'services/outletResolve.js',
  'services/journalistScout.js',
  'services/pressMediaResearch.js',
  'services/prospecting/research.js',
  // Weekly Mondays 06:35 via tender/ingest with onlySearch. Listed as
  // human-triggered when this guard first shipped, which was wrong: it is the
  // only paid tender source and runs unattended. A guard that classifies
  // wrongly is worse than none, because it reads as assurance.
  'services/tender/sources/webSearch.js',
  // Also miscategorised at first: the scheduler runs runAllClients.
  'services/aiVisibility.js',
];

// Cron-driven billers whose gate lives in the CALLER rather than in the file
// itself, because the file generates one thing and the loop is elsewhere.
// Both halves are checked: the file's features must be budgeted, and the
// named caller must actually hold a gate. Gating inside would also block a
// person who clicked Generate, which is not the intent.
const GATED_BY_CALLER = {
  'services/strategistReport.js': 'services/scheduler.js',
};

// Interactive paths: a person clicks and waits, so the work is bounded by the
// human. They are listed rather than detected so that moving one onto a cron
// forces a deliberate decision here.
const HUMAN_TRIGGERED = new Set([
  'routes/chat.js', 'routes/prAddon.js',
  'services/adCreative.js', 'services/refineChat.js', 'services/socialCaptions.js',
  'services/socialPlanner.js', 'services/social.js', 'services/reelScript.js',
  'services/outreachAi.js', 'services/mediaAssistant.js', 'services/contentReviewer.js',
  'services/contactTidy.js', 'services/tagTidy.js',
  'services/tender/addByUrl.js', 'services/tender/chat.js',
  'services/claude.js',  // the wrapper itself; it holds the global cap
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let failures = 0;
const fail = (msg) => { console.error(`FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS  ${msg}`);

const files = walk(SRC);
const directSdk = files.filter((f) => fs.readFileSync(f, 'utf8').includes('new Anthropic('))
  .map((f) => path.relative(SRC, f));

// 1. Every cron-driven biller checks its budget.
for (const rel of CRON_DRIVEN) {
  const body = fs.readFileSync(path.join(SRC, rel), 'utf8');
  if (/taskCapReached|assertUnderTaskCap/.test(body)) pass(`${rel} checks its task budget`);
  else fail(`${rel} bills Anthropic on a cron but never checks a task budget. `
    + `Add: if (await budget.taskCapReached('<task>')) break;`);
}

for (const [rel, caller] of Object.entries(GATED_BY_CALLER)) {
  const callerBody = fs.readFileSync(path.join(SRC, caller), 'utf8');
  if (/taskCapReached|assertUnderTaskCap/.test(callerBody)) pass(`${rel} is gated by ${caller}`);
  else fail(`${rel} relies on ${caller} for its budget gate, but ${caller} has none.`);
}

// 2. No direct-SDK file is unaccounted for. A new one must be classified as
//    cron-driven (and gated) or human-triggered, on purpose.
const known = new Set([...CRON_DRIVEN, ...Object.keys(GATED_BY_CALLER), ...HUMAN_TRIGGERED]);
for (const rel of directSdk) {
  if (!known.has(rel)) {
    fail(`${rel} calls the Anthropic SDK directly but is not classified. `
      + `Add it to CRON_DRIVEN (and gate it) or to HUMAN_TRIGGERED in ${path.basename(__filename)}.`);
  }
}
if (directSdk.every((r) => known.has(r))) pass(`all ${directSdk.length} direct-SDK callers are classified`);

// 3. Every feature a cron-driven biller records must belong to a task budget,
//    or the budget cannot see the spend at all.
// Every migration that seeds a task budget, so a feature added in a later one
// still counts. Reading only 185 would fail a correctly-budgeted feature.
const MIG = path.join(__dirname, '..', 'migrations');
const SEEDED = fs.readdirSync(MIG)
  .filter((f) => /ai_task_budgets|task_budget/.test(f))
  .map((f) => fs.readFileSync(path.join(MIG, f), 'utf8'))
  .join('\n');
for (const rel of [...CRON_DRIVEN, ...Object.keys(GATED_BY_CALLER)]) {
  const body = fs.readFileSync(path.join(SRC, rel), 'utf8');
  for (const m of body.matchAll(/feature:\s*'([a-z_0-9]+)'/g)) {
    if (SEEDED.includes(`'${m[1]}'`)) pass(`${rel}: feature ${m[1]} is in a task budget`);
    else fail(`${rel}: feature '${m[1]}' is in no task budget, so its spend is invisible to every cap.`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

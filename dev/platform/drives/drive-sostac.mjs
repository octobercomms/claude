// SOSTAC with nothing tailored: every phase carries its method.
//
// This is the state a new client starts in, and the state in which the plan
// was forty lines saying what to do and nothing about how. The fix before this
// one was a paragraph promising that guidance would arrive at tailor time,
// which is why the item came back.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const B = 'http://127.0.0.1:4599';
await page.goto(`${B}/clients/c1/dashboard/sostac`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const PHASES = ['Situation Analysis', 'Objectives', 'Strategy', 'Tactics', 'Action', 'Control'];

const summaries = await page.evaluate(() =>
  [...document.querySelectorAll('.app-main details.sostac-how summary')].map(s => s.innerText.trim()));
const phaseOpeners = summaries.filter(s => /How to work this phase/.test(s));
ok(phaseOpeners.length === 6, 'all six phases carry a method', `found ${phaseOpeners.length}`);

// Nothing is tailored, so no item should claim item-level steps.
ok(!summaries.some(s => /How to do this$/.test(s)),
   'and no item pretends to have steps written for this client');

// Collapsed: the plan still reads as a checklist.
const openByDefault = await page.evaluate(() =>
  [...document.querySelectorAll('.app-main details.sostac-how')].filter(d => d.open).length);
ok(openByDefault === 0, 'they start collapsed, so the plan scans as a plan', `open: ${openByDefault}`);

// Each phase's method sits in that phase's own card, with the right content.
const perPhase = await page.evaluate((phases) => {
  const out = {};
  for (const card of document.querySelectorAll('.app-main .card')) {
    const h = card.querySelector('.h2');
    const title = h?.innerText.trim();
    if (!title || !phases.includes(title)) continue;
    const d = card.querySelector('details.sostac-how');
    if (!d) { out[title] = null; continue; }
    d.open = true;
    out[title] = {
      aim: d.querySelector('p')?.innerText.trim() || '',
      steps: [...d.querySelectorAll('ol li')].map(li => li.innerText.trim()),
      omi: [...d.querySelectorAll('p')].map(p => p.innerText.trim()).find(t => t.startsWith('In OMI:')) || '',
    };
  }
  return out;
}, PHASES);

for (const p of PHASES) {
  const m = perPhase[p];
  ok(!!m, `${p} has its own method in its own card`);
  if (!m) continue;
  ok(m.aim.length > 40, `${p}: the aim is a sentence, not a label`, m.aim.slice(0, 60));
  ok(m.steps.length >= 4, `${p}: ${m.steps.length} steps`);
  ok(/^In OMI: /.test(m.omi) && m.omi.includes('→'), `${p}: names the screens`, m.omi.slice(0, 70));
}

// The guidance is specific. A generic method would survive a find-and-replace
// of the client's whole sector; this one names figures and screens.
const allText = Object.values(perPhase).filter(Boolean)
  .flatMap(m => [m.aim, m.omi, ...m.steps]).join(' ');
ok(/CAC/.test(allText) && /ROAS/.test(allText), 'it talks in the numbers the work is judged on');
ok((allText.match(/→/g) || []).length >= 20, 'and points at real screens throughout',
   `${(allText.match(/→/g) || []).length} references`);
ok(/twenty started/.test(allText), 'and says the thing an agency needs told');

// The paragraph at the top no longer defers.
const intro = await page.evaluate(() => document.querySelector('.app-main').innerText);
ok(/each phase below opens with/.test(intro), 'the intro points at the method');
ok(!/add step-by-step guidance under each one\.\s*$/m.test(intro),
   'and no longer promises guidance for later instead of giving it');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/sostac.png', fullPage: false });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

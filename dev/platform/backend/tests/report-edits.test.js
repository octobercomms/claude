// Editing a generated report before it reaches a client.
//
// The report is an ordered array of typed sections, and that one array renders
// twice: into the A4 PDF and into the email body, by two separate renderers.
// Everything here guards one of two claims.
//
// 1. The server does not store the document it is sent. Edits are merged onto
//    the generated sections, field by field, so a payload cannot change what a
//    section IS — only the words in it. This matters more than it looks,
//    because a malformed section does not fail loudly: both renderers return ''
//    for a chart with no chart and for an empty metrics grid. The client would
//    receive a report with a hole in it and the send would report success.
//
// 2. The two renderers agree. An edit that reaches the email body but not the
//    PDF means a client reading the attachment sees a different report from the
//    one in the message, and nobody internally would see it either way.
//
// The field lists here are written out by hand rather than read from
// EDITABLE_BY_TYPE. Deriving them from the module under test is how a guard
// comes to assert nothing: narrow the whitelist and a derived test generates
// fewer assertions and still reports 0 failed.
//
//   node tests/report-edits.test.js

const assert = require('assert');
const reportEdits = require('../src/services/reportEdits');
const pdfService = require('../src/services/pdfService');
const emailService = require('../src/services/emailService');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };
const throws = (what, fn, re) => {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw, `${what}: nothing was thrown, so the payload would have been stored`);
  assert.ok(re.test(threw.message),
    `${what}: threw "${threw.message}", which does not say what was wrong — an operator reads this`);
  passed += 1;
  console.log(`PASS  ${what}`);
};

// A generated report, close to what templateRenderer produces.
const generated = () => ([
  { id: 'intro', type: 'narrative', title: 'Overview', text: 'Traffic grew.\nSpend held flat.' },
  {
    id: 'kpis', type: 'metrics_grid', title: 'Headline numbers', insight: 'Sessions up on last month.',
    cells: [
      { label: 'Sessions', value: '1,204', delta: '12%', deltaDirection: 'up', previous: '1,075' },
      { label: 'Leads', value: '38', delta: '4%', deltaDirection: 'down', previous: '40' },
    ],
  },
  { id: 'rankings', type: 'tables', title: 'Keywords', tables: [{ headers: ['Term', 'Pos'], rows: [['oak table', '4']] }] },
  { id: 'spend', type: 'bar_chart', title: 'Spend by channel', chart: { bars: [{ label: 'Meta', value: 420 }] } },
]);

// ── what may be edited ──────────────────────────────────────────────────────

const reworded = generated();
reworded[0].title = 'What happened';
reworded[0].text = 'Traffic grew because the Meta account came back on.';
reworded[0].note = 'We paused Meta for the first week of October.';
const afterReword = reportEdits.mergeEdits(generated(), reworded);

ok('a narrative title, body and note are saved as typed', () => {
  const intro = afterReword.find(s => s.id === 'intro');
  assert.strictEqual(intro.title, 'What happened');
  assert.strictEqual(intro.text, 'Traffic grew because the Meta account came back on.');
  assert.strictEqual(intro.note, 'We paused Meta for the first week of October.',
    'the typed comment did not survive the merge, so clicking and typing saves nothing');
});

const cellEdit = generated();
cellEdit[1].cells[0].label = 'Visits';
cellEdit[1].cells[0].value = '1,210';
const afterCellEdit = reportEdits.mergeEdits(generated(), cellEdit);

ok('a metric label and value can be reworded', () => {
  const cell = afterCellEdit.find(s => s.id === 'kpis').cells[0];
  assert.strictEqual(cell.label, 'Visits');
  assert.strictEqual(cell.value, '1,210');
});

// ── what may not ────────────────────────────────────────────────────────────

ok('a renumbered cell loses the comparison that no longer matches it', () => {
  const renumbered = generated();
  renumbered[1].cells[0].value = '9,000';
  const cell = reportEdits.mergeEdits(generated(), renumbered).find(s => s.id === 'kpis').cells[0];
  // Keeping them produced "9,000 / up 12% / vs 1,075": a contradiction the
  // client can catch with mental arithmetic and nobody internally would. The
  // delta is computed against the generated figure and nothing recomputes it,
  // so the only honest options were to drop the comparison or refuse the edit.
  assert.strictEqual(cell.value, '9,000');
  assert.strictEqual(cell.delta, undefined,
    'an edited value kept its old delta, so the cell now contradicts itself');
  assert.strictEqual(cell.deltaDirection, undefined, 'the delta arrow survived an edited value');
  assert.strictEqual(cell.previous, undefined,
    'the previous-period figure survived an edited value, so the comparison is against a number nobody wrote');
});

ok('a reworded label keeps the comparison, because wording does not invalidate it', () => {
  const relabelled = generated();
  relabelled[1].cells[0].label = 'Visits';
  const cell = reportEdits.mergeEdits(generated(), relabelled).find(s => s.id === 'kpis').cells[0];
  assert.strictEqual(cell.label, 'Visits');
  assert.strictEqual(cell.delta, '12%',
    'renaming Sessions to Visits threw away a true comparison — the drop is meant to follow the figure, not the wording');
  assert.strictEqual(cell.previous, '1,075');
});

ok('an insight can be corrected', () => {
  const fixed = generated();
  fixed[1].insight = 'Sessions are up, but enquiries are not.';
  const merged = reportEdits.mergeEdits(generated(), fixed);
  // Claude writes it, it is an assertion about the numbers, and it goes to the
  // client in italics under the heading. Leaving it uneditable meant the only
  // remedy for a wrong one was hiding the whole section.
  assert.strictEqual(merged.find(s => s.id === 'kpis').insight, 'Sessions are up, but enquiries are not.',
    'a corrected insight did not save, so a wrong machine claim can only be removed with its section');
});

ok('a narrative insight reaches the PDF as well as the email', () => {
  const withInsight = [{ id: 'intro', type: 'narrative', title: 'Overview', text: 'Body.', insight: 'A claim about the month.' }];
  const pdf = pdfService.buildTemplateReportHtml({ client: { name: 'X' }, period: 'P', sections: withInsight });
  const mail = emailService.buildFullReportEmailHtml({ clientName: 'X', period: 'P', periodLabel: 'P', sections: withInsight });
  for (const [name, html] of [['PDF', pdf], ['email', mail]]) {
    assert.ok(html.includes('A claim about the month.'),
      `a narrative's insight is missing from the ${name}. It rendered in the email and vanished from the `
      + 'attachment, which is the disagreement between these two renderers that nobody would ever see');
  }
});

ok('a hand-typed delta is ignored and the computed comparison kept', () => {
  const faked = generated();
  faked[1].cells[0].delta = '400%';
  faked[1].cells[0].deltaDirection = 'up';
  faked[1].cells[0].previous = '3';
  const merged = reportEdits.mergeEdits(generated(), faked);
  const cell = merged.find(s => s.id === 'kpis').cells[0];
  // The value is untouched here, so the generated comparison stands. A typed
  // delta must not replace it: that would let a report claim any change it
  // likes under a figure it did not change.
  assert.strictEqual(cell.delta, '12%', 'a typed delta was saved, so a report can claim any change it likes');
  assert.strictEqual(cell.deltaDirection, 'up');
  assert.strictEqual(cell.previous, '1,075', 'a typed previous-period figure was saved');
});

ok('chart and table data are taken from the generated report, not the payload', () => {
  const faked = generated();
  faked[2].tables = [{ headers: ['Term', 'Pos'], rows: [['oak table', '1']] }];
  faked[3].chart = { bars: [{ label: 'Meta', value: 99999 }] };
  const merged = reportEdits.mergeEdits(generated(), faked);
  assert.strictEqual(merged.find(s => s.id === 'rankings').tables[0].rows[0][1], '4',
    'a table cell was overwritten from the payload — connector data would become typeable');
  assert.strictEqual(merged.find(s => s.id === 'spend').chart.bars[0].value, 420,
    'chart data was overwritten from the payload');
});

throws('a section cannot change type',
  () => {
    const faked = generated();
    faked[3] = { id: 'spend', type: 'narrative', title: 'Spend by channel', text: 'whatever I like' };
    reportEdits.mergeEdits(generated(), faked);
  },
  /cannot become|is a bar_chart/i);

throws('a new metrics grid cannot be added',
  () => {
    const faked = generated();
    faked.push({ id: 'invented', type: 'metrics_grid', title: 'Extra', cells: [{ label: 'Revenue', value: '£1m' }] });
    reportEdits.mergeEdits(generated(), faked);
  },
  /only a note can be added/i);

throws('a section cannot be silently dropped',
  () => reportEdits.mergeEdits(generated(), generated().filter(s => s.id !== 'spend')),
  /left out of the edit.*spend|spend/i);

throws('a metric cell cannot be added or removed',
  () => {
    const faked = generated();
    faked[1].cells = [faked[1].cells[0]];
    reportEdits.mergeEdits(generated(), faked);
  },
  /expected 2 metric cell/i);

throws('a section cannot appear twice',
  () => {
    const faked = generated();
    faked.push({ ...faked[0] });
    reportEdits.mergeEdits(generated(), faked);
  },
  /appears twice/i);

throws('a paste longer than the cap is refused with its size',
  () => {
    const faked = generated();
    faked[0].text = 'x'.repeat(20001);
    reportEdits.mergeEdits(generated(), faked);
  },
  /20001 characters.*limit is 20000/i);

throws('a report with no stored sections cannot be edited',
  () => reportEdits.mergeEdits(undefined, generated()),
  /no stored sections/i);

ok('a null byte is stripped rather than failing the write', () => {
  const faked = generated();
  faked[0].note = 'Meta paused\u0000 early October';
  const merged = reportEdits.mergeEdits(generated(), faked);
  // Postgres rejects \u0000 in text. Reaching the write with one means a save
  // that fails with a driver error and tells the operator nothing.
  assert.strictEqual(merged[0].note, 'Meta paused early October');
});

// ── added notes ─────────────────────────────────────────────────────────────

const withNote = generated();
withNote.splice(1, 0, { id: 'note-context', type: 'note', title: 'Context', text: 'Meta was paused for a week.' });
const afterNote = reportEdits.mergeEdits(generated(), withNote);

ok('a note can be added between sections, where it was put', () => {
  assert.strictEqual(afterNote.length, 5);
  assert.strictEqual(afterNote[1].id, 'note-context',
    'the added note moved, so where somebody types is not where the client reads it');
  assert.strictEqual(afterNote[1].type, 'note');
  assert.strictEqual(afterNote[1].added, true, 'an added note is not marked as added, so nothing can show it apart');
});

throws('an empty note is refused rather than rendering a blank panel',
  () => reportEdits.mergeEdits(generated(), [...generated(), { id: 'n1', type: 'note', title: '  ', text: '' }]),
  /empty/i);

// ── hiding ──────────────────────────────────────────────────────────────────

const hiddenPayload = generated();
hiddenPayload[3].hidden = true;
const afterHide = reportEdits.mergeEdits(generated(), hiddenPayload);

ok('hiding keeps the section stored so it can be put back', () => {
  const spend = afterHide.find(s => s.id === 'spend');
  assert.ok(spend, 'the hidden section was dropped from storage, so hiding is not reversible');
  assert.strictEqual(spend.hidden, true);
  assert.strictEqual(reportEdits.visibleSections(afterHide).length, 3);
});

ok('unhiding is just the absence of the flag', () => {
  const back = reportEdits.mergeEdits(generated(), generated());
  assert.strictEqual(reportEdits.visibleSections(back).length, 4,
    'a section stayed hidden after the flag was removed, so hiding is one-way');
});

// ── which array is the live one ──────────────────────────────────────────────

ok('the edited array wins over the generated original', () => {
  const report = {
    summary: { sections: generated() },
    edited_sections: afterReword,
  };
  const live = reportEdits.effectiveSections(report);
  assert.strictEqual(live.find(s => s.id === 'intro').title, 'What happened',
    'the generated report was treated as live, so saved edits would never be sent');
});

ok('an unedited report falls back to the generated original', () => {
  const report = { summary: { sections: generated() }, edited_sections: null };
  assert.strictEqual(reportEdits.effectiveSections(report).length, 4);
  assert.deepStrictEqual(reportEdits.effectiveSections({}), []);
  assert.deepStrictEqual(reportEdits.effectiveSections(null), []);
});

ok('an empty edited array does not blank the report', () => {
  // A row written with [] — a frontend bug, or a half-finished migration —
  // must not mean "send a report with no sections in it".
  const report = { summary: { sections: generated() }, edited_sections: [] };
  assert.strictEqual(reportEdits.effectiveSections(report).length, 4);
});

ok('the diff names what a person changed', () => {
  const changes = reportEdits.diffSections(generated(), afterReword);
  const intro = changes.find(c => c.id === 'intro');
  assert.ok(intro, 'an edited section is not reported as changed, so nothing can mark it in the editor');
  assert.strictEqual(intro.change, 'edited');
  assert.deepStrictEqual(intro.fields.sort(), ['note', 'text', 'title']);
  assert.strictEqual(reportEdits.diffSections(generated(), generated()).length, 0,
    'an untouched report reports changes, so the marking means nothing');
  const hid = reportEdits.diffSections(generated(), afterHide).find(c => c.id === 'spend');
  assert.strictEqual(hid.change, 'hidden');
  const added = reportEdits.diffSections(generated(), afterNote).find(c => c.id === 'note-context');
  assert.strictEqual(added.change, 'added');
  const cellChange = reportEdits.diffSections(generated(), afterCellEdit).find(c => c.id === 'kpis');
  assert.ok(cellChange && cellChange.fields.includes('cells'),
    'a reworded metric cell is not reported as a change');
});

// ── the two renderers have to agree ─────────────────────────────────────────

const edited = reportEdits.mergeEdits(generated(), (() => {
  const p = generated();
  p[0].note = 'Meta was paused for the first week, which is the dip.';
  p[1].note = 'Leads are down because we switched off the broad audience.';
  p[3].hidden = true;
  p.splice(2, 0, { id: 'note-standalone', type: 'note', title: 'A note on the quarter', text: 'Budget moves to search in December.' });
  return p;
})());

const pdfHtml = pdfService.buildTemplateReportHtml({
  client: { name: 'Forgeworks' }, period: 'October 2026',
  sections: reportEdits.visibleSections(edited),
});
const emailHtml = emailService.buildFullReportEmailHtml({
  clientName: 'Forgeworks', period: 'October 2026', periodLabel: 'October 2026',
  sections: reportEdits.visibleSections(edited),
});

ok('a comment on a section reaches the PDF and the email', () => {
  for (const [name, html] of [['PDF', pdfHtml], ['email', emailHtml]]) {
    assert.ok(html.includes('Meta was paused for the first week, which is the dip.'),
      `the comment is missing from the ${name}. The same sections array feeds both renderers; a field `
      + `handled in one and not the other means the client's attachment and their email say different things`);
    assert.ok(html.includes('Leads are down because we switched off the broad audience.'),
      `the second section's comment is missing from the ${name}`);
  }
});

ok('a standalone note reaches the PDF and the email', () => {
  for (const [name, html] of [['PDF', pdfHtml], ['email', emailHtml]]) {
    assert.ok(html.includes('Budget moves to search in December.'),
      `an added note is missing from the ${name}, so typing one between sections changes nothing`);
    assert.ok(html.includes('A note on the quarter'), `the added note's heading is missing from the ${name}`);
  }
});

ok('a hidden section reaches neither', () => {
  for (const [name, html] of [['PDF', pdfHtml], ['email', emailHtml]]) {
    assert.ok(!html.includes('Spend by channel'),
      `a hidden section still renders in the ${name} — the AM removed it and the client got it anyway`);
  }
});

ok('each renderer drops a hidden section on its own, unfiltered', () => {
  // Every caller today filters with visibleSections before rendering. Both
  // renderers check `hidden` as well, and this asserts those checks work on
  // the raw array — otherwise they are unreachable code that reads like a
  // guarantee, and the next caller to forget the filter emails a client the
  // section somebody removed.
  const pdf = pdfService.buildTemplateReportHtml({ client: { name: 'X' }, period: 'P', sections: edited });
  const mail = emailService.buildFullReportEmailHtml({ clientName: 'X', period: 'P', periodLabel: 'P', sections: edited });
  for (const [name, html] of [['PDF', pdf], ['email', mail]]) {
    assert.ok(!html.includes('Spend by channel'),
      `the ${name} renderer rendered a hidden section when handed the unfiltered array, so its own `
      + 'hidden check does nothing');
    assert.ok(html.includes('Headline numbers'),
      `the ${name} renderer dropped a visible section too, so the check is reading the wrong flag`);
  }
});

ok('a comment is escaped on the way into both', () => {
  const nasty = reportEdits.mergeEdits(generated(), (() => {
    const p = generated();
    p[0].note = '<script>alert(1)</script> & "quoted"';
    return p;
  })());
  const visible = reportEdits.visibleSections(nasty);
  const pdf = pdfService.buildTemplateReportHtml({ client: { name: 'X' }, period: 'P', sections: visible });
  const mail = emailService.buildFullReportEmailHtml({ clientName: 'X', period: 'P', periodLabel: 'P', sections: visible });
  for (const [name, html] of [['PDF', pdf], ['email', mail]]) {
    assert.ok(!html.includes('<script>'),
      `a typed <script> tag reached the ${name} as markup. Nothing in this project sanitises HTML; `
      + 'escaping at render is the whole defence, and this is copy that gets emailed to a client');
    assert.ok(html.includes('&lt;script&gt;'), `the typed text is missing from the ${name} entirely`);
  }
});

ok('the editable fields are the ones named here, and no others', () => {
  // Written out literally. If a future change widens this, say by making
  // `cells` editable on a bar_chart or adding chart data to the list, this
  // fails and the widening has to be deliberate.
  const { EDITABLE_BY_TYPE, EDITABLE_CELL_FIELDS } = reportEdits._internals;
  assert.deepStrictEqual(EDITABLE_BY_TYPE.narrative, ['title', 'note', 'text', 'insight']);
  assert.deepStrictEqual(EDITABLE_BY_TYPE.metrics_grid, ['title', 'note', 'cells', 'insight']);
  assert.deepStrictEqual(EDITABLE_BY_TYPE.tables, ['title', 'note', 'insight']);
  assert.deepStrictEqual(EDITABLE_BY_TYPE.bar_chart, ['title', 'note', 'insight']);
  assert.deepStrictEqual(EDITABLE_BY_TYPE.position_distribution, ['title', 'note', 'insight']);
  assert.deepStrictEqual(EDITABLE_CELL_FIELDS, ['label', 'value']);
  assert.deepStrictEqual(reportEdits._internals.COMPARISON_FIELDS, ['delta', 'deltaDirection', 'previous'],
    'the comparison fields dropped on a value edit have changed; a field added to a cell and left out '
    + 'of this list will survive an edit it contradicts');
});

// ── the way in ──────────────────────────────────────────────────────────────

ok('the review nudge links to the report, not to the schedule screen', () => {
  process.env.PUBLIC_URL = 'https://platform.example.com/';
  const url = emailService.reportReviewUrl('c-1', 'r-9');
  // The nudge is the only thing that makes a held report reachable. It pointed
  // at /clients/:id/dashboard/reports, where the one action on a report row is
  // Delete, while the email said "read it, add anything it is missing, and
  // send it from the Reports page".
  assert.strictEqual(url, 'https://platform.example.com/clients/c-1/reports/r-9',
    'the review email does not link to the report, so a held report has no surface to be reviewed on');
  delete process.env.PUBLIC_URL;
  assert.ok(emailService.reportReviewUrl('c-1', 'r-9').startsWith('https://'),
    'with no PUBLIC_URL set the link is relative, which is not clickable in an email client');
});

console.log(`\n${passed} passed, 0 failed`);

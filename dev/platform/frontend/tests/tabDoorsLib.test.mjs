// The scanner behind the tab-door check, tested on sources where the answer
// is known by construction.
//
// This exists because the two earlier attempts at this analysis were both
// wrong — one regex missed accordion items, another matched a page's own API
// call as a link to itself — and both looked fine until a mutation test
// disagreed. A finder nobody has checked is worse than no finder, because it
// is believed.
//
//   node --test tests/tabDoorsLib.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jsxElementExtent, overviewBlocks, knownTabs, doorSites,
  tabsOnlyReachableFromOverview, tabsWithNoDoorAtAll,
  hasHandlerByReference, tabsInConstArrays,
} from './lib/tabDoors.mjs';

test('a handler passed by reference is recognised', () => {
  assert.equal(hasHandlerByReference('<StepRail onStep={setTab} />'), true);
  assert.equal(hasHandlerByReference('<X onNavTab={setSocialTab} />'), true);
  assert.equal(hasHandlerByReference("<X onClick={() => setTab('a')} />"), false,
    'an inline arrow names its tab, so it is already findable');
});

test('const arrays yield their tab names', () => {
  const got = tabsInConstArrays("const PIPELINE_STEPS = ['brief', 'render'];\nconst x = ['nope'];");
  assert.deepEqual([...got].sort(), ['brief', 'render'], 'only SCREAMING_CASE consts count');
});

test('it finds a self-closing element, nested braces and all', () => {
  const s = `<div><SuiteOverview a={{x: '}'}} b={() => f('}')} />\n<p/></div>`;
  const e = jsxElementExtent(s, s.indexOf('<SuiteOverview'));
  assert.ok(e, 'no extent found');
  const block = s.slice(e.start, e.end);
  assert.ok(block.endsWith('/>'), block);
  assert.ok(!block.includes('<p/>'), 'ran past the element');
});

test('a brace inside a string does not end it early', () => {
  const s = `<SuiteOverview label="}" tpl={\`a}b\`} />`;
  const e = jsxElementExtent(s, 0);
  assert.equal(s.slice(e.start, e.end), s);
});

test('it handles an element with children rather than self-closing', () => {
  const s = `<SuiteOverview x={1}>\n  <Child />\n</SuiteOverview>\n<After/>`;
  const e = jsxElementExtent(s, 0);
  const block = s.slice(e.start, e.end);
  assert.ok(block.endsWith('</SuiteOverview>'), block);
  assert.ok(!block.includes('<After/>'));
});

test('both overview component names are found', () => {
  const s = `<SuiteOverview a={1} />\n<SocialSuiteOverview b={2} />`;
  assert.equal(overviewBlocks(s).length, 2);
});

test('known tabs come from the useTabParam allow-list', () => {
  const s = `const [tab, setTab] = useTabParam('overview', ['overview', 'health', 'build']);`;
  assert.deepEqual(knownTabs(s).sort(), ['build', 'health', 'overview']);
});

test('a door is counted from a handler, a strip key, a descriptor or an accordion', () => {
  assert.equal(doorSites(`setTab('health')`, 'health').length, 1);
  assert.equal(doorSites(`{ key: 'health', label: 'Health' }`, 'health').length, 1);
  assert.equal(doorSites(`{ id: 'health', tab: 'health' }`, 'health').length, 2);
  assert.equal(doorSites(`<AccordionItem id="health" />`, 'health').length, 1);
});

test('a tab reachable only from inside the overview is named', () => {
  const src = `
    const [tab, setTab] = useTabParam('overview', ['overview', 'buried', 'visible']);
    <PageShell tabs={[{ key: 'visible', onClick: () => setTab('visible') }]}>
    <SuiteOverview
      otherJobs={{ items: [{ label: 'Buried', onClick: () => setTab('buried') }] }}
    />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), ['buried']);
});

test('a tab with a door outside the overview is not named, even if also linked inside', () => {
  const src = `
    const [tab, setTab] = useTabParam('overview', ['overview', 'both']);
    <AccordionItem id="both" />
    <SuiteOverview otherJobs={{ items: [{ onClick: () => setTab('both') }] }} />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), []);
});

test('a page with no overview names nothing', () => {
  const src = `
    const [tab, setTab] = useTabParam('a', ['a', 'b']);
    <button onClick={() => setTab('b')} />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), []);
});

test('a step-rail tab is not reported as an overview casualty', () => {
  // The Paid and Owned pipelines: handler by reference, keys out of an array.
  const src = `
    const [tab, setTab] = useTabParam('overview', ['overview', 'render', 'launch']);
    const PIPELINE_STEPS = ['render', 'launch'];
    <StepRail onStep={setTab} steps={META.map((m, i) => ({ key: PIPELINE_STEPS[i] }))} />
    <SuiteOverview otherJobs={{ items: [{ onClick: () => setTab('render') }] }} />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), []);
});

test('without a handler by reference, the array does not excuse a buried tab', () => {
  const src = `
    const [tab, setTab] = useTabParam('overview', ['overview', 'buried']);
    const SOME_LIST = ['buried'];
    <SuiteOverview otherJobs={{ items: [{ onClick: () => setTab('buried') }] }} />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), ['buried'],
    'an array alone is not a door — something must hand a setter to a component');
});

test('a tab with no door at all is reported separately, not as an overview casualty', () => {
  const src = `
    const [tab, setTab] = useTabParam('overview', ['overview', 'orphan', 'ok']);
    <AccordionItem id="ok" />
    <SuiteOverview x={1} />
  `;
  assert.deepEqual(tabsOnlyReachableFromOverview(src), [], 'it has no door, so the overview is not what is holding it up');
  assert.deepEqual(tabsWithNoDoorAtAll(src), ['orphan']);
});

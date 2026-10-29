// Finding the tabs that only an overview can reach.
//
// The suites are big — Owned carries 38 tabs, Shared 18, Paid 14 — and each
// one's Overview is a diagram of links into them. Deleting an overview is
// therefore a navigation change, not a cosmetic one: any tab whose only link
// lives inside it becomes a working page nobody can open. That has already
// happened three times in this codebase (ClientVideoPage, ReportsPage,
// ClientBrandPage), each found by a person asking where something was.
//
// So before an overview is deleted, this says exactly which tabs need a door
// somewhere else first.
//
// The analysis is deliberately conservative in one direction: it counts many
// things as a door (a tab-strip key, an accordion item, any setTab call), so
// it under-reports rather than over-reports. A tab it names is one it could
// find no other way to reach, which is the list worth acting on.

// Walk a JSX element from `<Name` to its matching `/>` or `</Name>`, counting
// braces outside strings. Written out rather than regexed because the props
// contain nested braces and template literals, and a regex that "mostly works"
// on this is how the earlier attempts at this check went wrong.
export function jsxElementExtent(src, startIndex) {
  let i = src.indexOf('>', startIndex);
  if (i === -1) return null;
  // Self-closing on the opening tag?
  let depth = 0, inStr = null, j = startIndex;
  while (j < src.length) {
    const c = src[j], prev = src[j - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      j += 1; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; j += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '/' && src[j + 1] === '>' && depth === 0) return { start: startIndex, end: j + 2 };
    else if (c === '>' && depth === 0 && src[j - 1] !== '/') {
      // Opening tag closed; find the matching closing tag by name.
      const name = (src.slice(startIndex + 1).match(/^[A-Za-z0-9_.]+/) || [''])[0];
      const close = src.indexOf(`</${name}>`, j);
      return close === -1 ? { start: startIndex, end: j + 1 } : { start: startIndex, end: close + name.length + 3 };
    }
    j += 1;
  }
  return null;
}

export function overviewBlocks(src) {
  const out = [];
  for (const m of src.matchAll(/<(?:Social)?SuiteOverview\b/g)) {
    const ext = jsxElementExtent(src, m.index);
    if (ext) out.push(ext);
  }
  return out;
}

// Every tab name a page knows about, from its useTabParam allow-list.
//
// The first argument is the default, and it is not always a literal — the
// embedded pages pass a ternary. Requiring a literal there is why this first
// read as "0 tabs" on Outreach and Chat, which is the worst possible failure
// for a check like this: it reports nothing wrong because it looked at
// nothing.
export function knownTabs(src) {
  const m = src.match(/useTabParam\(([\s\S]*?),\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...new Set([...m[2].matchAll(/'([a-z_]+)'/g)].map(x => x[1]))];
}

// Everywhere a tab can be reached from. Each entry is an index into the source
// so it can be tested against the overview extents.
//
// Counted as a door:
//   setTab('x') / setActiveTab('x') / setSocialTab('x')   — a click handler
//   key: 'x'                                              — a tab-strip entry
//   tab: 'x'                                              — a section descriptor
//   id="x" / id: 'x'                                      — an accordion item
export function doorSites(src, tab) {
  const esc = tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`set(?:Tab|ActiveTab|SocialTab)\\(\\s*'${esc}'`, 'g'),
    new RegExp(`\\bkey:\\s*'${esc}'`, 'g'),
    new RegExp(`\\btab:\\s*'${esc}'`, 'g'),
    new RegExp(`\\bid="${esc}"`, 'g'),
    new RegExp(`\\bid:\\s*'${esc}'`, 'g'),
  ];
  const sites = [];
  for (const re of patterns) for (const m of src.matchAll(re)) sites.push(m.index);
  return sites;
}

// A step rail is a door this cannot see directly.
//
// Paid's creative pipeline and Owned's content pipeline both render
// <StepRail onStep={setTab} steps={META.map((m, i) => ({ key: KEYS[i], ... }))}>
// — the handler is passed by reference and the keys come out of an array by
// index, so there is no `setTab('render')` anywhere to find. The first version
// of this check reported all four Paid pipeline steps and Owned's topic_map as
// reachable only from an overview. Every one was wrong, and wrong in the
// expensive direction: it made two overviews look load-bearing when they are
// not.
//
// Resolving which array feeds which rail is more static analysis than this
// deserves. Instead: if a file hands a tab setter to a component by reference
// at all, treat every tab name it lists in a const array as reachable. That
// can miss a real orphan; it will not invent one. The module leans that way on
// purpose — a check that cries wolf is a check people learn to ignore.
export function hasHandlerByReference(src) {
  return /\bon[A-Z][A-Za-z]*=\{set(?:Tab|ActiveTab|SocialTab)\}/.test(src);
}

export function tabsInConstArrays(src) {
  const names = new Set();
  for (const m of src.matchAll(/\bconst\s+[A-Z_][A-Z0-9_]*\s*=\s*\[([^\]]*)\]/g)) {
    for (const t of m[1].matchAll(/'([a-z_]+)'/g)) names.add(t[1]);
  }
  return names;
}

// Tabs whose every door is inside an overview — the ones deleting it orphans.
export function tabsOnlyReachableFromOverview(src) {
  const blocks = overviewBlocks(src);
  if (!blocks.length) return [];
  const inOverview = (i) => blocks.some(b => i >= b.start && i < b.end);
  const railReachable = hasHandlerByReference(src) ? tabsInConstArrays(src) : new Set();
  const out = [];
  for (const tab of knownTabs(src)) {
    if (tab === 'overview') continue;
    if (railReachable.has(tab)) continue;
    const sites = doorSites(src, tab);
    if (!sites.length) continue;             // no door at all — a different problem
    if (sites.every(inOverview)) out.push(tab);
  }
  return out.sort();
}

// Tabs with no door anywhere, overview included. These are already orphaned.
export function tabsWithNoDoorAtAll(src) {
  return knownTabs(src)
    .filter(t => t !== 'overview')
    .filter(t => doorSites(src, t).length === 0)
    .sort();
}

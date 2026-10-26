/**
 * Painting the layers onto the release.
 *
 * Its own module because it is the one part of the editor that can be exercised
 * without React: a string of HTML in, a string of HTML out. It is checked in a
 * real browser by tests/browser/highlight.mjs, which exists because the
 * detector layer was written painting nothing at all — its pass ran last, by
 * which point the other three had split every text node it needed to match
 * against. No source-level check could have seen that.
 */

/**
 * Wrap every sentence that carries no checkable fact.
 *
 * Located by text match rather than character offset: a sentence is long and
 * distinctive enough to find, and a miss degrades to "not highlighted" instead
 * of to a wrongly placed highlight.
 */
function markPass(doc, root, needles, cls) {
  if (!needles.length) return;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    if (node.parentNode && node.parentNode.nodeName === 'MARK'
        && node.parentNode.getAttribute('class') === cls) continue;
    const text = node.nodeValue;
    const hits = [];
    for (const needle of needles) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(needle, from);
        if (i < 0) break;
        // Whole words only, so "realm" does not fire inside "realms of".
        const before = i === 0 ? '' : text[i - 1];
        const after = text[i + needle.length] || '';
        if (!/[\w'’]/.test(before) && !/[\w'’]/.test(after)) hits.push([i, i + needle.length]);
        from = i + needle.length;
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const frag = doc.createDocumentFragment();
    let cur = 0;
    for (const [from, to] of hits) {
      if (from < cur) continue;
      if (from > cur) frag.appendChild(doc.createTextNode(text.slice(cur, from)));
      const mark = doc.createElement('mark');
      mark.setAttribute('class', cls);
      mark.textContent = text.slice(from, to);
      frag.appendChild(mark);
      cur = to;
    }
    if (cur < text.length) frag.appendChild(doc.createTextNode(text.slice(cur)));
    node.parentNode.replaceChild(frag, node);
  }
}


/**
 * The layers, painted in this order: sentences first, then the phrases
 * that sit inside them.
 *
 * Order matters and was learned the hard way. Almost every tell sits inside a
 * sentence carrying no fact, so a single pass with an outermost-wins rule
 * swallowed every underline. Each pass re-walks the text, including text now
 * inside an earlier mark, so the layers nest instead of competing.
 *
 * Located by text match rather than character offset, so a miss degrades to
 * "not marked" instead of to a mark in the wrong place.
 *
 * What is never marked: the structural tells — sentence rhythm, parallelism,
 * even paragraph length. The only way to act on a highlight there is to rough
 * the prose up on purpose, which is the one category detectors are trained to
 * catch. They stay in the diagnostic block, where you read them and do nothing.
 */
function highlightLayers(html, layers) {
  if (!html || typeof DOMParser === 'undefined') return html;
  const passes = layers.filter((l) => l.needles.length);
  if (!passes.length) return html;
  try {
    const doc = new DOMParser().parseFromString(`<div id="oc-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('oc-root');
    for (const layer of passes) markPass(doc, root, layer.needles, layer.cls);
    return root.innerHTML;
  } catch { return html; }
}

/** Strip our own marks back out, so what is stored is the operator's HTML. */
function unmark(html) {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(`<div id="oc-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('oc-root');
    for (const m of [...root.querySelectorAll('mark.oc-bare, mark.oc-tell, mark.oc-fact, mark.oc-machine')]) {
      m.replaceWith(...m.childNodes);
    }
    root.normalize();
    return root.innerHTML;
  } catch { return html; }
}

export { highlightLayers, unmark };

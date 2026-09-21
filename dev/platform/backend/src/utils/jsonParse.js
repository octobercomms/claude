// Tolerant JSON parsing for LLM output. Models are told to "return ONLY JSON",
// but in practice they sometimes wrap it in prose ("Here's the brief:"), fence
// it in ```json, add a trailing comma, or — most often on a long answer — get
// cut off at max_tokens mid-object, leaving structurally-invalid JSON. A bare
// JSON.parse throws on all of these and the user sees "Claude returned malformed
// JSON". parseJsonLoose recovers the intended object where it reasonably can.
//
// Strategy, in order, first success wins:
//   1. parse as-is (fast path — well-behaved responses)
//   2. strip code fences + isolate the outermost {...} / [...] (drops prose)
//   3. remove trailing commas
//   4. best-effort close: balance any unclosed string/array/object (truncation)
// Only ever removes wrapper text or appends closers — never rewrites values —
// so a recovered object is a faithful (if partial, when truncated) parse.

function stripFencesAndProse(text) {
  let s = String(text).replace(/```(?:json)?/gi, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) return s; // no JSON delimiters — let the caller's parse fail
  const openCh = s[start];
  const closeCh = openCh === '{' ? '}' : ']';
  const lastClose = s.lastIndexOf(closeCh);
  return lastClose > start ? s.slice(start, lastClose + 1) : s.slice(start);
}

function stripTrailingCommas(s) {
  // A comma directly before a closing } or ] — invalid in strict JSON.
  return s.replace(/,\s*([}\]])/g, '$1');
}

// Append the closers needed to balance a truncated fragment: shut an open
// string, then unwind the bracket stack. Ignores brackets inside strings and
// respects backslash escapes so it doesn't miscount.
function balanceClose(s) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  // A truncated fragment often ends mid-key/value with a dangling comma or colon;
  // trim those so the appended closer yields valid JSON.
  out = out.replace(/[,:]\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

// Parse LLM output into an object/array, recovering from the common ways a
// model breaks strict JSON. Throws SyntaxError if nothing parses.
function parseJsonLoose(text) {
  if (text == null) throw new SyntaxError('parseJsonLoose: empty input');
  const raw = String(text).trim();
  const isolated = stripFencesAndProse(raw);
  const candidates = [
    raw,
    isolated,
    stripTrailingCommas(isolated),
    balanceClose(stripTrailingCommas(isolated)),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* try the next repair */ }
  }
  throw new SyntaxError('parseJsonLoose: could not parse JSON from model output');
}

module.exports = { parseJsonLoose };

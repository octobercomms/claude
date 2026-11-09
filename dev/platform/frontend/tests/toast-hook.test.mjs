/**
 * `useToast()` returns the toast function itself, not an object holding one.
 *
 * ── The fault this exists to have caught ─────────────────────────────
 *
 * `ToastContext.Provider` is given `value={toast}` — the function. So
 * `useToast()` is the function, and 116 call sites across the app correctly
 * write `const toast = useToast()`.
 *
 * `components/accounts/AccountsPanels.jsx` wrote `const { toast } =
 * useToast()` in all fifteen of its panels. A function is an object, so
 * destructuring a property it does not have is not an error: `toast` comes
 * out `undefined`, silently, and the component renders perfectly. The throw
 * waits until a handler actually calls it — on a click, or in a catch block
 * reporting some other failure:
 *
 *     TypeError: toast is not a function
 *
 * which is what reached the error digest as "s is not a function" and "a is
 * not a function", minified, across /accounts/extension, /accounts/drive,
 * /accounts/suppliers, /accounts/invoices, /accounts/weekly-digest and
 * /accounts/reconcile: twenty-odd occurrences in twenty-four hours, every one
 * of them a button that did nothing.
 *
 * The first check below is the hazard measured rather than remembered, so the
 * reason this guard exists cannot decay into folklore.
 *
 *   node --test tests/toast-hook.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every .jsx and .js file under src/. */
function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, found);
    else if (/\.(jsx|js)$/.test(entry.name)) found.push(p);
  }
  return found;
}

const FILES = walk(SRC);

describe('the hazard itself', () => {
  it('destructuring a property off a function gives undefined, silently', () => {
    // No throw, no warning. This is why the mistake survives review and a
    // render, and only surfaces when somebody clicks.
    const fn = () => 'toasted';
    const { toast } = fn;
    assert.equal(toast, undefined);
    assert.throws(() => toast('hello'), TypeError);
  });
});

describe('what the provider actually supplies', () => {
  const context = fs.readFileSync(path.join(SRC, 'context', 'ToastContext.jsx'), 'utf8');

  it('is the function, not an object wrapping it', () => {
    // If this ever becomes `value={{ toast }}`, the rule below inverts and
    // this test is the place that says so.
    assert.match(
      context, /<ToastContext\.Provider value=\{toast\}>/,
      'ToastContext no longer provides the bare function. If that is deliberate,'
      + ' the call sites and this guard both need to change together.'
    );
  });

  it('is handed straight back by the hook', () => {
    assert.match(context, /export function useToast\(\)\s*\{\s*return useContext\(ToastContext\);\s*\}/);
  });
});

describe('every call site', () => {
  it('takes the function, never a property of it', () => {
    const broken = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/(?:const|let|var)\s*\{[^}]*\}\s*=\s*useToast\(\)/.test(line)) {
          broken.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(
      broken, [],
      'these destructure a property off the toast function, so `toast` is'
      + ' undefined and every handler that calls it throws on click:\n  '
      + broken.join('\n  ')
    );
  });

  it('and there are call sites to check, so an empty sweep cannot pass', () => {
    const callers = FILES.filter((f) => /=\s*useToast\(\)/.test(fs.readFileSync(f, 'utf8')));
    assert.ok(callers.length > 50, `found only ${callers.length} files calling useToast()`);
  });
});

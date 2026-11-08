/**
 * What a batch is about to do, decided before it does any of it.
 *
 * The runner's job is simple: bind one template to N sets of content and
 * enqueue N renders. The hard part is everything that can be wrong with the
 * N sets, and WHEN you find out. A thirty-item run that discovers at item
 * nineteen that the client only uploaded four photographs for it has already
 * spent eighteen renders' worth of money and an hour of wall clock, and the
 * operator is not watching. So the plan is computed whole, first, and shown.
 *
 * Everything here is PURE. No database, no filesystem, no clock, no binding.
 * That is deliberate and it is the repo's own lesson, paid for twice: a
 * decision written inline where exercising it needs a live endpoint is a
 * decision a mutation can delete with no test noticing (see `queueFor` in the
 * strategist, and `summarise` in FeatureCost). The decisions here are which
 * items can run, what the run costs, and whether the month can afford it,
 * which are exactly the decisions an operator wants to see before committing
 * and exactly the ones that must not be reinvented in a route handler.
 *
 * A note on money, because this module produces figures an operator acts on.
 * EVERY cost here is USD, because every provider OMI renders through bills in
 * USD. October works in USD, GBP and EUR, and the house rule is that a number
 * whose currency is left to be guessed reads as a fact in whichever currency
 * the reader had in mind. The field names say `_usd` for that reason and the
 * UI prints the symbol. See utils/money.js.
 */

import { validateTemplate, bindTemplate } from './compositionTemplate.mjs';

/**
 * What to call a slot's content in a sentence an operator reads.
 *
 * Not `${kind}s`: that gives "1 audios" and "2 texts". These strings appear
 * next to a rejected row in the review sheet, which is the one place in the
 * batch where sloppy copy costs real time, because the operator is deciding
 * what to go and fix.
 */
const WORDS = {
  clip: ['clip', 'clips'],
  still: ['photograph', 'photographs'],
  design: ['design page', 'design pages'],
  text: ['line of text', 'lines of text'],
  audio: ['audio track', 'audio tracks'],
};

function words(kind, n) {
  const pair = WORDS[kind] || [kind, `${kind}s`];
  return n === 1 ? pair[0] : pair[1];
}

/** Rounded the way money is, not the way floats are. */
function usd(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

/**
 * What one slot still needs, or null when it is satisfied.
 *
 * Checked WITHOUT binding, because binding throws on the first problem and a
 * pre-flight has to report all of them at once. An operator fixing a batch
 * wants the list, not a sequence of thirty separate failures.
 */
function slotProblem(slot, supplied) {
  const min = slot.min ?? 1;
  const max = slot.max ?? min;
  const given = Array.isArray(supplied) ? supplied : (supplied == null ? [] : [supplied]);

  if (given.length < min) {
    return {
      slot: slot.id,
      kind: slot.kind,
      need: min,
      got: given.length,
      // Written for the operator, not the developer. This string is what
      // appears next to a rejected row in the review sheet.
      says: given.length === 0
        ? `needs ${min} ${words(slot.kind, min)} and has none`
        : `needs ${min} ${words(slot.kind, min)} and has ${given.length}`,
    };
  }

  // A text slot takes lines of text; everything else takes sources. Catching
  // it here rather than at bind time is the difference between a pre-flight
  // that says "item 7, titles: expected text" and a render that dies.
  if (slot.kind === 'text') {
    const bad = given.findIndex((x) => typeof x !== 'string' || !x.trim());
    if (bad !== -1) {
      return {
        slot: slot.id,
        kind: slot.kind,
        says: `is on-screen type, so entry ${bad + 1} must be a line of text`,
      };
    }
  } else {
    const bad = given.findIndex((x) => !x || typeof x !== 'object' || !x.kind);
    if (bad !== -1) {
      return {
        slot: slot.id,
        kind: slot.kind,
        says: `entry ${bad + 1} is not a source (it needs a \`kind\`)`,
      };
    }
    // An audio slot wants an audio source and a picture slot does not. The
    // model would catch this at validate(), but then it is a bound
    // composition failing rather than a row the operator can fix.
    const wantsAudio = slot.kind === 'audio';
    const wrong = given.findIndex((x) => (x.kind === 'audio') !== wantsAudio);
    if (wrong !== -1) {
      return {
        slot: slot.id,
        kind: slot.kind,
        says: wantsAudio
          ? `wants an audio track and entry ${wrong + 1} is a ${words(given[wrong].kind, 1)}`
          : `takes ${words(slot.kind, 2)} and entry ${wrong + 1} is an audio track`,
      };
    }
  }

  // Extras are not an error. The template says max, the binder takes the
  // first max, and an operator who dropped eleven photographs into a slot
  // that uses eight has not made a mistake worth stopping a batch for. It is
  // reported so the review sheet can say what was left out.
  return given.length > max
    ? { slot: slot.id, kind: slot.kind, unused: given.length - max, says: null }
    : null;
}

/**
 * Check one item's content against a template without binding it.
 *
 * Returns `{ ok, problems, unused }`. `problems` are reasons the item cannot
 * run; `unused` is content the template has no room for, which is a note
 * rather than a fault.
 */
export function checkItem(template, content = {}) {
  const problems = [];
  const unused = [];

  for (const key of Object.keys(content)) {
    if (!template.slots.some((s) => s.id === key)) {
      problems.push({
        slot: key,
        says: `is not a slot of "${template.id}"`
          + ` (${template.slots.map((s) => s.id).join(', ')})`,
      });
    }
  }

  for (const slot of template.slots) {
    const p = slotProblem(slot, content[slot.id]);
    if (!p) continue;
    if (p.says) problems.push(p);
    else unused.push(p);
  }

  return { ok: problems.length === 0, problems, unused };
}

/**
 * The plan for a whole batch.
 *
 * `items` is a list of `{ content, ref }`, where `ref` is whatever the caller
 * needs to find this item again (a social_posts id, an index, a filename). It
 * is carried through untouched so the review sheet can link a row back to
 * where it came from.
 *
 * `perItemUsd` is what one render of this template is expected to cost,
 * normally the median from the feature-cost figures. `remainingUsd` is what
 * the month's budget has left, or null when no budget is set, which is the
 * ordinary case because budgets are opt-in.
 *
 * Nothing here throws on bad content. A batch where four of thirty items are
 * short of photographs should run the twenty-six and say so, because the
 * alternative is that the operator fixes one item, re-submits, and finds the
 * next. Only a broken TEMPLATE throws, because that is a bug rather than an
 * operator error and no amount of fixing content will help.
 */
export function planBatch({
  template,
  items = [],
  perItemUsd = null,
  remainingUsd = null,
  capUsd = null,
} = {}) {
  const templateErrors = validateTemplate(template);
  if (templateErrors.length) {
    throw new Error(
      `template "${template?.id || '?'}" is invalid, so no batch can be planned:`
      + ` ${templateErrors.join('; ')}`
    );
  }

  const checked = items.map((item, index) => {
    const { content = {}, ref = null } = item || {};
    const { ok, problems, unused } = checkItem(template, content);
    return { index, ref, ok, problems, unused };
  });

  const runnable = checked.filter((c) => c.ok);
  const blocked = checked.filter((c) => !c.ok);

  const estUsd = Number.isFinite(perItemUsd) && perItemUsd > 0
    ? usd(perItemUsd * runnable.length)
    : null;

  // Over budget is about what WILL run, not what was submitted. Counting the
  // blocked items would overstate the spend and could refuse a batch that
  // fits, which is the same class of mistake as a warning that cries wolf:
  // the operator learns to click past it.
  const overBudget = estUsd != null && Number.isFinite(remainingUsd) && estUsd > remainingUsd;

  // How many fit. Shown rather than silently truncated: a runner that quietly
  // does eleven of thirty is indistinguishable from one that is broken.
  const affordable = (estUsd != null && Number.isFinite(remainingUsd)
    && Number.isFinite(perItemUsd) && perItemUsd > 0)
    ? Math.max(0, Math.min(runnable.length, Math.floor(remainingUsd / perItemUsd)))
    : null;

  return {
    templateId: template.id,
    templateName: template.name,
    total: checked.length,
    runnable: runnable.length,
    blocked: blocked.length,
    items: checked,
    perItemUsd: usd(perItemUsd),
    estUsd,
    remainingUsd: usd(remainingUsd),
    capUsd: usd(capUsd),
    overBudget,
    affordable,
    // One line for the pre-flight, so the operator reads a sentence rather
    // than assembling one from five numbers.
    says: summarise({
      total: checked.length,
      runnable: runnable.length,
      blocked: blocked.length,
      estUsd,
      remainingUsd,
      overBudget,
      affordable,
    }),
  };
}

/**
 * The pre-flight sentence.
 *
 * Separate and exported because it is a decision about what the operator is
 * told, and that deserves a test of its own rather than living inside a
 * return statement.
 */
export function summarise({
  total, runnable, blocked, estUsd, remainingUsd, overBudget, affordable,
}) {
  if (!total) return 'Nothing to run.';
  if (!runnable) {
    return `None of the ${total} items can run: every one is missing content.`;
  }

  const money = estUsd == null
    ? ''
    : ` for about $${estUsd < 1 ? estUsd.toFixed(2) : estUsd.toFixed(estUsd < 100 ? 2 : 0)}`;
  const head = runnable === total
    ? `${total} video${total === 1 ? '' : 's'}${money}.`
    : `${runnable} of ${total} videos${money}. ${blocked} cannot run yet.`;

  if (overBudget) {
    const left = Number.isFinite(remainingUsd) ? `$${remainingUsd.toFixed(2)}` : 'the budget';
    const fits = affordable == null ? '' : ` About ${affordable} would fit.`;
    return `${head} That is more than the ${left} left this month.${fits}`;
  }
  return head;
}

/**
 * Bind the runnable items, in order, without letting one failure stop the
 * rest.
 *
 * A bind can still throw after a clean pre-flight: the pre-flight checks
 * content against slots, while binding also runs the composition model's own
 * validation, and a template could be legal yet produce something the model
 * refuses. That is a bug in the template rather than the content, so the item
 * carries the error and the batch continues. Per-item failure must not fail
 * the batch; the old stills path passed provider errors straight through,
 * which is the wrong behaviour for a thirty-item run.
 *
 * `seed` makes the whole batch reproducible on timing and treatment: the same
 * seed and the same content give the same pacing and camera moves, so a
 * re-run after fixing one item does not re-cut the twenty-nine that were fine.
 */
export function bindBatch({ template, items = [], seed = '' } = {}) {
  const plan = planBatch({ template, items });
  const out = [];

  for (const entry of plan.items) {
    if (!entry.ok) {
      out.push({ ...entry, comp: null, error: entry.problems.map((p) => `${p.slot} ${p.says}`).join('; ') });
      continue;
    }
    try {
      const comp = bindTemplate(template, items[entry.index].content, {
        index: entry.index,
        seed,
      });
      out.push({ ...entry, comp, error: null });
    } catch (err) {
      out.push({ ...entry, comp: null, error: err.message });
    }
  }

  return {
    ...plan,
    items: out,
    bound: out.filter((o) => o.comp).length,
    failed: out.filter((o) => !o.comp).length,
  };
}

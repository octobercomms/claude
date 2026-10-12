/**
 * The brief builder — what replaces generating the prose.
 *
 * `write_press_release_draft()` in the WordPress plugin, and the "Draft with
 * Claude" button here, produce a finished release. Testing against Pangram on
 * 2026-10-12 flagged one 100% AI, flagged it again after hand editing, and
 * cleared a human-written one. The signal is structural, so editing does not
 * shift it. The lever is where the prose originates.
 *
 * So this returns a FACT SHEET WITH EMPTY SLOTS and the questions that fill
 * them. If the model returns a sentence of body copy, this function has
 * failed at its only job.
 *
 * See docs/editorial/human-writing-standard.md and
 * docs/october-outreach/HUMANITY-CHECKER-BRIEF.md §5.
 */
const claude = require('./claude');
const budget = require('./budget');

const TASK = 'press_writing';

const SYSTEM = [
  'You build reporting checklists for a human press-release writer. You never write the release.',
  '',
  'Return slots, never sentences. No draft paragraphs, no suggested phrasing, no headline options,',
  'no "you could say". The person reading this writes every word of the release themselves.',
  '',
  'HARD CONSTRAINT: never invent a fact, a quote, a name, a measurement, a date, a cost or an award.',
  'Where something is not in the material you were given, the slot stays empty and the question that',
  'would fill it goes in the interview list. Fabricated specifics about a real client are a far worse',
  'failure than a release that reads as machine-written.',
  '',
  'British English. Return JSON only.',
].join('\n');

/** The slot shape, mirroring §6 of the standard. */
function emptyBrief() {
  return {
    news_hook: '',
    moves: { hook: '', scope: '', material: '', impact: '', context: '', proof: '' },
    quotes: [
      { name: '', title: '', organisation: '', quote: '' },
      { name: '', title: '', organisation: '', quote: '' },
      { name: '', title: '', organisation: '', quote: '' },
    ],
    facts: { dates: '', dimensions: '', materials: '', cost: '', location: '', credits: '', photographer: '' },
    assets: { images: '', press_contact: '' },
    questions: [],
  };
}

/** Strip anything that looks like drafted prose out of a slot. */
function slot(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // A slot is a fact or a fragment. Two or more sentences means the model
  // started writing the release, so it is dropped rather than shown.
  const sentenceish = (s.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceish >= 2 && s.split(/\s+/).length > 25) return '';
  return s.slice(0, 600);
}

async function build({ clientId, title, brand, angle, keyFacts }) {
  await budget.assertUnderTaskCap(TASK);

  const user = [
    'Build the reporting checklist for this press release.',
    '',
    `Working title: ${title || '(none given)'}`,
    brand ? `Client: ${brand}` : '',
    angle ? `Why it is newsworthy: ${angle}` : '',
    keyFacts ? `What we already know:\n${keyFacts}` : 'We have been given nothing beyond the title.',
    '',
    'Fill a slot ONLY from what you were given above. Everything else stays empty.',
    '',
    'The six moves a release has to make:',
    '1 hook — a phrase somebody actually said about it',
    '2 scope — a number, a size, a first or a largest',
    '3 material — what it is made of and where it sits',
    '4 impact — what changed, and for whom',
    '5 context — the programme, portfolio or trend it belongs to',
    '6 proof — an award, a publication, or a named collaborator',
    '',
    'Then write the interview questions that would fill every slot you left empty.',
    'Questions are for a 40-minute call with the client. Specific to this project, not generic.',
    '',
    'Return JSON only:',
    '{"news_hook":"","moves":{"hook":"","scope":"","material":"","impact":"","context":"","proof":""},',
    '"quotes":[{"name":"","title":"","organisation":"","quote":""}],',
    '"facts":{"dates":"","dimensions":"","materials":"","cost":"","location":"","credits":"","photographer":""},',
    '"assets":{"images":"","press_contact":""},',
    '"questions":["…"]}',
  ].filter(Boolean).join('\n');

  const text = await claude.callClaude({
    max_tokens: 2000, system: SYSTEM, user, feature: 'press_brief', clientId,
  });

  const out = emptyBrief();
  let parsed = null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\{[\s\S]*?\})\s*```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { parsed = JSON.parse(raw.trim()); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return out;

  out.news_hook = slot(parsed.news_hook);
  for (const k of Object.keys(out.moves)) out.moves[k] = slot(parsed.moves?.[k]);
  if (Array.isArray(parsed.quotes)) {
    out.quotes = parsed.quotes.slice(0, 3).map((q) => ({
      name: slot(q?.name), title: slot(q?.title),
      organisation: slot(q?.organisation), quote: slot(q?.quote),
    }));
    while (out.quotes.length < 3) out.quotes.push({ name: '', title: '', organisation: '', quote: '' });
  }
  for (const k of Object.keys(out.facts)) out.facts[k] = slot(parsed.facts?.[k]);
  for (const k of Object.keys(out.assets)) out.assets[k] = slot(parsed.assets?.[k]);
  out.questions = Array.isArray(parsed.questions)
    ? parsed.questions.map((q) => String(q || '').trim().slice(0, 300)).filter(Boolean).slice(0, 16)
    : [];
  return out;
}

/**
 * The one semantic check the deterministic analyser cannot do: which claims in
 * the written release are not carried by a named source, a number or a date.
 * Explicit button, never on typing, and it never blocks a save.
 */
async function checkClaims({ clientId, bodyHtml, brief }) {
  await budget.assertUnderTaskCap(TASK);
  const text = String(bodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  if (!text) return { unsupported: [], unfilled_moves: [] };

  const user = [
    'Here is a written press release.',
    '',
    text,
    '',
    'Two questions, and nothing else.',
    '1. Which of the six moves does it fail to make? hook, scope, material, impact, context, proof.',
    '2. Which specific claims in it are not supported by a named source, a number, or a date?',
    '   Quote the claim verbatim so the writer can find it. Do not rewrite it.',
    '',
    'Do not suggest wording. Do not offer to improve it. Report only.',
    'Return JSON only: {"unfilled_moves":["scope"],"unsupported":[{"claim":"…","why":"…"}]}',
  ].join('\n');

  const out = await claude.callClaude({
    max_tokens: 1200,
    system: 'You audit press releases for unsupported claims. You never rewrite copy. British English. JSON only.',
    user, feature: 'press_factcheck', clientId,
  });
  const fence = out.match(/```json\s*([\s\S]*?)```/i) || out.match(/```\s*(\{[\s\S]*?\})\s*```/);
  const raw = fence ? fence[1] : out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  try {
    const v = JSON.parse(raw.trim());
    return {
      unfilled_moves: Array.isArray(v.unfilled_moves) ? v.unfilled_moves.map(String).slice(0, 6) : [],
      unsupported: Array.isArray(v.unsupported)
        ? v.unsupported.slice(0, 25).map((u) => ({
            claim: String(u?.claim || '').slice(0, 400),
            why: String(u?.why || '').slice(0, 300),
          })).filter((u) => u.claim)
        : [],
    };
  } catch { return { unfilled_moves: [], unsupported: [] }; }
}

module.exports = { build, checkClaims, emptyBrief, TASK };

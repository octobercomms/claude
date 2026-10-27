/**
 * Does this reel do the things that make a reel work?
 *
 * Seven checks, every one of them deterministic, free and instant. They run on
 * a transcript and an edit, the same way the press release dial runs on a
 * document, and they are advisory in exactly the same way. A checklist that
 * blocks gets switched off within a fortnight.
 *
 * Each check carries the rule it came from, so a wrong rule can be argued with
 * rather than obeyed. The rules are October's own, from the Oculi Mundi growth
 * plan, which is the best source in the repo for this because it states them as
 * numbers rather than as taste.
 *
 * One honest limit, and the panel says it on screen: the conversion figures and
 * the reach thresholds in that plan are reasoned planning assumptions, not
 * things October has measured. They are good assumptions. They become findings
 * once the four numbers per post come back for thirty reels. A green tick that
 * implies more certainty than exists is how a team starts optimising for the
 * wrong thing.
 */

/**
 * Hype, which is the thing a high-register account does not do.
 *
 * From the plan: "Low-register accounts hype ordinary facts. High-register
 * accounts underplay extraordinary ones. The restraint is what reads as
 * authority." These are the words that do the hyping.
 */
const HYPE = [
  'amazing', 'incredible', 'insane', 'crazy', 'unbelievable', 'mind-blowing',
  'mindblowing', 'jaw-dropping', 'shocking', 'stunning', 'epic', 'wild',
  'you won\'t believe', 'wait for it', 'this will blow your mind', 'game-changer',
  'game changer', 'secret', 'hack', 'nobody talks about', 'everyone is wrong',
  'literally', 'obsessed', 'iconic', 'legendary', 'must-see', 'viral',
];

/**
 * The account talking about itself, which the plan found is its own
 * worst-performing content: "Static event reminders, five of the eight lowest
 * performing posts. Reposts of press coverage. Podcast guest announcements,
 * every one of them."
 */
const SELF_PROMOTION = [
  'join us', 'book now', 'tickets', 'rsvp', 'sign up', 'register',
  'we are delighted', 'we are thrilled', 'delighted to announce',
  'proud to announce', 'featured in', 'as seen in', 'our new podcast',
  'this week\'s guest', 'on the podcast', 'link in bio', 'swipe up',
  'our latest', 'we have been', 'our team',
];

/**
 * A fact a reader could check: a number, a year, a measurement.
 *
 * Written numerals count, and the plan's own exemplar is why. "For two hundred
 * years, every map of the world showed a continent at the bottom" carries no
 * digit at all, and a check that failed the hook the plan holds up as correct
 * would be teaching the wrong lesson on its first use.
 */
const WRITTEN = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|'
  + 'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|'
  + 'forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|'
  + 'dozen|half|quarter)';
const FACT = new RegExp(
  '(\\b\\d[\\d,.]*\\s*(%|per cent|million|billion|thousand|metres?|km|ft|years?|hours?|days?)'
  + '|\\b(1[0-9]{3}|20[0-9]{2})\\b'
  + '|\\b\\d[\\d,.]*\\b'
  + `|\\b${WRITTEN}(\\s+${WRITTEN})*\\s+(years?|centur\\w+|decades?|months?|days?|times?|`
  + 'per cent|%|metres?|miles?|people|objects?|maps?|copies|editions?))', 'i');

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function has(text, phrases) {
  const t = ` ${String(text || '').toLowerCase()} `;
  return phrases.filter((p) => t.includes(` ${p} `) || t.includes(`${p} `) || t.includes(` ${p}`));
}

/**
 * `timings` is Whisper's word array: [{ word, start, end }]. `edit` is what the
 * operator has chosen so far: { duration_s, caption_template, brand }.
 */
export function checkReel(input) {
  // A default parameter only fires on undefined, so `{ edit: null }` sails past
  // it and the first property read throws. This panel runs on every keystroke
  // against a half-finished edit, so partial and null input is the normal case
  // rather than the exception.
  const { timings, edit } = input || {};
  const list = Array.isArray(timings) ? timings : [];
  const ed = edit || {};
  const transcript = list.map((w) => w.word).join(' ');
  const duration = Number(ed.duration_s)
    || (list.length ? list[list.length - 1].end : 0);

  // The hook is everything said in the first three seconds, which is where the
  // plan says the decision is made: "people decide in two seconds whether to
  // follow".
  const hookWords = list.filter((w) => w.start < 3);
  const hook = hookWords.map((w) => w.word).join(' ');

  const first = list.length ? list[0].start : null;
  const hypeFound = has(hook, HYPE);
  const selfFound = has(transcript, SELF_PROMOTION);
  const brand = String(ed.brand || '').trim().toLowerCase();
  const brandHits = brand
    ? (transcript.toLowerCase().match(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length
    : 0;

  const checks = [
    {
      key: 'hook_timing',
      label: 'The hook lands inside one second',
      pass: first !== null && first <= 1.0,
      detail: first === null ? 'Nothing is said yet.'
        : `First word at ${first.toFixed(2)}s.`,
      rule: 'People decide in two seconds whether to follow.',
    },
    {
      key: 'hook_is_a_fact',
      label: 'The hook states a fact, not a claim',
      pass: hook ? FACT.test(hook) : null,
      detail: hook ? `Opens: "${hook.slice(0, 70)}${hook.length > 70 ? '…' : ''}"`
        : 'No hook to read yet.',
      rule: 'Every example in the plan carries a number or a date.',
    },
    {
      key: 'stated_flatly',
      label: 'Stated flatly, not hyped',
      // Null rather than true when there is nothing to read. A green tick on an
      // empty reel is how an operator learns to stop looking at the panel.
      pass: hook ? hypeFound.length === 0 : null,
      detail: hypeFound.length ? `Hype in the hook: ${hypeFound.join(', ')}` : 'No hype words.',
      rule: 'Low-register accounts hype ordinary facts. The restraint is what reads as authority.',
    },
    {
      key: 'captions',
      label: 'Captions are burned in',
      pass: !!ed.caption_template,
      detail: ed.caption_template ? `Template: ${ed.caption_template}` : 'No template chosen.',
      rule: 'Most viewing is silent.',
    },
    {
      key: 'not_about_us',
      label: 'Not the account talking about itself',
      // Naming the brand once is attribution. Three times is an advert, and the
      // event and press vocabulary is the pattern the plan found at the bottom
      // of every performance list.
      pass: transcript ? (selfFound.length === 0 && brandHits < 3) : null,
      detail: selfFound.length ? `Reads as promotion: ${selfFound.slice(0, 3).join(', ')}`
        : brandHits >= 3 ? `The brand is named ${brandHits} times.`
          : 'About the subject, not the account.',
      rule: 'Event reminders, press reposts and guest announcements were the three '
        + 'worst-performing post types in the account\'s own analysis.',
    },
    {
      key: 'one_idea',
      label: 'One fact, carried to a payoff',
      // A reel that races is a list. The plan's own format is one error put on
      // screen and then traced, which is slow by construction.
      pass: duration > 0 && list.length / duration <= 3.6,
      detail: duration ? `${(list.length / duration).toFixed(1)} words a second.`
        : 'No audio yet.',
      rule: 'The zoom reveal: wide view, push into the detail, land the fact.',
    },
    {
      key: 'length',
      label: 'Thirty to forty-five seconds',
      pass: duration >= 20 && duration <= 50,
      detail: duration ? `${Math.round(duration)}s.` : 'No duration yet.',
      rule: 'Thirty to forty seconds, from the plan\'s own format note.',
    },
  ];

  // Only a true counts. A check that cannot be judged yet is neither a pass
  // nor a failure, and counting it either way misreports the reel.
  const passed = checks.filter((c) => c.pass === true).length;
  const unknown = checks.filter((c) => c.pass === null).length;
  return {
    checks,
    passed,
    total: checks.length,
    // Deliberately not a score out of a hundred. Seven of seven is not a
    // prediction that a reel will travel; it is a statement that it does the
    // seven things, which is all these can honestly claim.
    unknown,
    verdict: passed === checks.length ? 'all_seven'
      : unknown ? 'early'
        : passed >= 5 ? 'most' : 'early',
    transcript_words: list.length,
    duration_s: duration ? +duration.toFixed(1) : 0,
  };
}

export const RULES = { HYPE, SELF_PROMOTION };

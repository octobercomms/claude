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
 * The thresholds that decide a pass, named here rather than left inline, so
 * the fingerprint below covers them. A rule change that moved the words but
 * not the numbers would otherwise read as the same rule set.
 */
export const THRESHOLDS = {
  hook_before_s: 1.0,
  hook_window_s: 3,
  brand_mentions_max: 3,
  words_per_second_max: 3.6,
  duration_min_s: 20,
  duration_max_s: 50,
};

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

/**
 * Does this text say any of these phrases?
 *
 * Whole phrase, case-insensitive, on word boundaries. "Garden design" matches
 * "our garden design practice" and not "gardens designed", which is a real
 * miss and a deliberate one: stemming would also match "designer gardens" and
 * every near-miss it invents is a keyword the reel does not actually say.
 *
 * Returns what matched rather than a boolean, because an operator asking "does
 * this reel carry a term we rank for" wants to know which one.
 */
function phrasesIn(text, phrases) {
  const haystack = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9']+/g, ' ')} `;
  const found = [];
  for (const raw of (Array.isArray(phrases) ? phrases : [])) {
    const needle = String(raw || '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
    if (!needle) continue;
    if (haystack.includes(` ${needle} `)) found.push(String(raw));
  }
  return found;
}

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
  const hookWords = list.filter((w) => w.start < THRESHOLDS.hook_window_s);
  const hook = hookWords.map((w) => w.word).join(' ');

  const first = list.length ? list[0].start : null;
  const hypeFound = has(hook, HYPE);
  const selfFound = has(transcript, SELF_PROMOTION);
  const brand = String(ed.brand || '').trim().toLowerCase();

  // The terms this client is trying to be found for, and where a reel can say
  // them: out loud, or on the screen. Both count, because both are read.
  const keywords = Array.isArray(ed.keywords) ? ed.keywords.filter(Boolean) : [];
  const onScreen = String(ed.on_screen_text || '');
  const termsFound = keywords.length ? phrasesIn(`${transcript} ${onScreen}`, keywords) : [];
  const brandHits = brand
    ? (transcript.toLowerCase().match(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length
    : 0;

  const checks = [
    {
      key: 'hook_timing',
      label: 'The hook lands inside one second',
      // Null, not false, with no transcript. An edit whose words have not been
      // timed yet is unjudged, and an amber dot against a reel that opens
      // perfectly well teaches an operator to ignore the panel just as fast as
      // a false tick does.
      pass: first === null ? null : first <= THRESHOLDS.hook_before_s,
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
      pass: transcript ? (selfFound.length === 0 && brandHits < THRESHOLDS.brand_mentions_max) : null,
      detail: selfFound.length ? `Reads as promotion: ${selfFound.slice(0, 3).join(', ')}`
        : brandHits >= THRESHOLDS.brand_mentions_max ? `The brand is named ${brandHits} times.`
          : 'About the subject, not the account.',
      rule: 'Event reminders, press reposts and guest announcements were the three '
        + 'worst-performing post types in the account\'s own analysis.',
    },
    {
      key: 'one_idea',
      label: 'One fact, carried to a payoff',
      // A reel that races is a list. The plan's own format is one error put on
      // screen and then traced, which is slow by construction.
      pass: duration > 0 && list.length
        ? list.length / duration <= THRESHOLDS.words_per_second_max : null,
      // Words per second needs both, and a duration without a transcript
      // reads as "0.0 words a second", which looks like a measurement of
      // silence rather than the absence of one.
      detail: duration && list.length ? `${(list.length / duration).toFixed(1)} words a second.`
        : 'No transcript yet.',
      rule: 'The zoom reveal: wide view, push into the detail, land the fact.',
    },
    {
      key: 'says_a_term_we_rank_for',
      label: 'Says something people search for',
      // Null when the client tracks no keywords: a reel cannot fail a test
      // that has nothing to test it against, and an amber dot on every reel
      // for every client without an SEO setup is how a panel gets ignored.
      pass: keywords.length ? termsFound.length > 0 : null,
      detail: !keywords.length
        ? 'No tracked search terms for this client yet.'
        : termsFound.length
          ? `Says: ${termsFound.slice(0, 3).join(', ')}`
          : `None of ${keywords.length} tracked terms are said or on screen.`,
      rule: 'The words spoken and on screen are what the platform reads to decide who '
        + 'to show a reel to. A term nobody searches is a term nobody finds, and forcing '
        + 'one in is worse than missing it.',
    },
    {
      key: 'length',
      label: 'Thirty to forty-five seconds',
      pass: duration > 0
        ? (duration >= THRESHOLDS.duration_min_s && duration <= THRESHOLDS.duration_max_s)
        : null,
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
    // Not 'all_seven'. A verdict named after a count is a verdict that lies
    // the first time a check is added, and one just was.
    verdict: passed === checks.length ? 'all'
      : unknown ? 'early'
        : passed >= 5 ? 'most' : 'early',
    transcript_words: list.length,
    duration_s: duration ? +duration.toFixed(1) : 0,
  };
}

export const RULES = { HYPE, SELF_PROMOTION };

/**
 * A short, stable fingerprint of the rule set.
 *
 * Recorded beside every check result, because a recorded pass only means
 * something next to the rules that granted it. Add a word to the hype list and
 * every row written before that is answering a different question; pooling the
 * two would produce a median over a mixture of rule sets, which is a number
 * that looks like a measurement and is not.
 *
 * Derived rather than hand-versioned. A constant to bump is a constant to
 * forget, and forgetting it is silent: the model keeps reporting, on a
 * population it has quietly merged.
 *
 * FNV-1a rather than a crypto hash: this runs in the browser as well as on the
 * server, it is not a security boundary, and a collision between two rule sets
 * of this size is not a risk worth a dependency.
 */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const RULES_FINGERPRINT = fnv1a(JSON.stringify({
  // Sorted, so reordering a list without changing it keeps the fingerprint and
  // the population together.
  hype: [...HYPE].sort(),
  self: [...SELF_PROMOTION].sort(),
  fact: FACT.source,
  thresholds: THRESHOLDS,
  // Read off the checker rather than retyped. A retyped list is a list that
  // disagrees with the code the first time a check is added.
  keys: checkReel({}).checks.map((c) => c.key),
}));

// Worked hook examples, for the vault when a client has none yet.
//
// "Hook vault — i've never understood this." The vault is a list of opening
// lines with no explanation of what an opening line is for, and its empty
// state said only "generate a brainstorm batch". So a new client's vault
// taught nothing, and an established one taught nothing either.
//
// These show the shape of each framework's opening. They are examples, badged
// as examples wherever they render: an example that cannot be told apart from
// real work is worse than no example, because somebody eventually ships it as
// their own. The same rule the press releases follow.
//
// Written for the clients October actually has — architecture, garden design,
// furniture, hospitality — because a hook about SaaS onboarding teaches an
// architecture account nothing about its own voice.

export const FRAMEWORKS = ['Hook-Story-Offer', 'AIDA', 'PAS', 'UGC'];

export const HOOK_EXAMPLES = [
  {
    hook: 'The client asked for one room. We rebuilt the roof.',
    framework: 'Hook-Story-Offer',
    why: 'A contradiction in nine words. The reader has to know how a room became a roof, and the story earns the offer at the end.',
  },
  {
    hook: 'Three questions to ask an architect before you sign anything.',
    framework: 'AIDA',
    why: 'Names a number and a decision the reader is already facing. It promises a finite read, which is why it gets one.',
  },
  {
    hook: 'Most planting plans fail in year two. Here is what the drawings leave out.',
    framework: 'PAS',
    why: 'States the problem as a fact with a timescale, then agitates it by implying the drawings you have are incomplete.',
  },
  {
    hook: 'I have had this chair for eleven years. Here is what it looks like now.',
    framework: 'UGC',
    why: 'First person, a specific number, and a promise of evidence. It reads as a person rather than a brand, which is the whole point of UGC.',
  },
  {
    hook: 'We costed the same extension three ways. The cheapest was not the cheapest.',
    framework: 'PAS',
    why: 'A number, a method, and a paradox. Budget transparency posts work when they show the working rather than claim to be transparent.',
  },
  {
    hook: 'The hotel wanted uniforms. What they needed was a laundry schedule.',
    framework: 'Hook-Story-Offer',
    why: 'Reframes the brief in one line. It flatters the reader by implying the real problem is the one nobody named.',
  },
];

// Sorted by framework, grouped, so the page can show one per framework rather
// than a flat list that reads as six unrelated opinions.
export function examplesByFramework(examples = HOOK_EXAMPLES) {
  const out = new Map();
  for (const f of FRAMEWORKS) {
    const got = examples.filter(e => e.framework === f);
    if (got.length) out.set(f, got);
  }
  // A framework nobody wrote an example for is left out rather than shown
  // empty; a framework an example names that is not in FRAMEWORKS is a typo
  // and would silently vanish, so it is surfaced instead.
  const unknown = examples.filter(e => !FRAMEWORKS.includes(e.framework));
  return { groups: out, unknown };
}

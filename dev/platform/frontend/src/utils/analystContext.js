// Which conversation the analyst panel opens, given where you are standing.
//
// In its own module rather than inside AnalystPanel.jsx so it can be tested
// without a JSX loader, and because it is the one piece of that component with
// consequences: the backend has carried four PESO pillar personas since they
// were built — owned, shared, paid, earned — each with its own history thread
// and its own action tool. Send it a name it does not recognise and it does
// not error, it silently serves the general analyst instead. A wrong entry
// here gets you a working chat on the wrong thread with the wrong tools, and
// nothing on screen says so.

// Keyed by the path segment after /clients/:id. Anything unlisted is the
// general analyst — the conversation Data used to hold.
export const PERSONA_BY_SECTION = {
  ads: { persona: 'paid', label: 'Paid' },
  pr: { persona: 'earned', label: 'Earned' },
  social: { persona: 'shared', label: 'Shared' },
  seo: { persona: 'owned', label: 'Owned' },
};

export function analystContextFor(pathname) {
  const m = /^\/clients\/[^/]+(?:\/([^/?]+))?/.exec(pathname || '');
  const section = m && m[1];
  return PERSONA_BY_SECTION[section] || { persona: 'analyst', label: null };
}

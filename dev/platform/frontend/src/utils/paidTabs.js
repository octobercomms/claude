// Where an old Paid link lands after the redesign.
//
// The Paid page lost "Health" (a container around the tab everyone opened),
// "playbook" (reference, now a drawer) and "resize" (an action on a creative,
// not a destination). Links to all three are already out in the world: the
// Monday email, saved report links, and anything an account lead bookmarked.
// A deep link that lands nowhere is the quietest kind of breakage, because
// the person who follows it assumes the feature was removed.
//
// Returns { tab, openPlaybook } — or null when the tab needs no redirect.
export function resolvePaidTab(tab) {
  switch (tab) {
    // Both were the numbers under different names.
    case 'health':
    case 'performance':
      return { tab: 'measure', openPlaybook: false };
    // The pipeline's old top-level aliases.
    case 'pipeline':
    case 'creative':
      return { tab: 'brief', openPlaybook: false };
    // The Paid library is gone — everything rendered is reachable from the
    // batch that made it, and from the Launch export. Resize was only ever
    // reachable from the library, so it has a row of its own and old
    // /ads/library links land there, which is the nearest thing that still
    // exists.
    case 'library':
      return { tab: 'resize', openPlaybook: false };
    // Audiences split into ICP, Segments and Customers. The page still calls
    // the segments screen 'audiences' internally, but its slug is 'segments'
    // now, so the old URL is a dead slug and has to be pointed at the screen
    // that inherited the work.
    case 'audiences':
      return { tab: 'audiences', openPlaybook: false };
    // The page it named is gone; the content opens over the landing tab.
    case 'playbook':
      return { tab: 'measure', openPlaybook: true };
    // Approve stopped being a step: minting a client link is a button in the
    // header, not a stage of production. The old URL lands on Launch, which
    // is where someone following it was heading next anyway, and the button
    // is on screen from there.
    case 'approve':
      return { tab: 'launch', openPlaybook: false };
    default:
      return null;
  }
}

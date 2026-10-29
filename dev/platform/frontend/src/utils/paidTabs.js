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
    // Resizing starts from the thing being resized.
    case 'resize':
      return { tab: 'library', openPlaybook: false };
    // The page it named is gone; the content opens over the landing tab.
    case 'playbook':
      return { tab: 'measure', openPlaybook: true };
    default:
      return null;
  }
}

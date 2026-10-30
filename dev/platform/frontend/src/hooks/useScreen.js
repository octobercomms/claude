import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { SECTIONS, slugForTab, tabForSlug, slugsOf } from '../nav/sections';

// The screen a section page is showing, read from the path.
//
// Replaces useTabParam for the eight pages behind a section panel. The screen
// used to be `?tab=`, which made every screen in the app share one query
// namespace: `?tab=reports` meant three different things depending on which
// page you were on, and `?tab=health` two. As a path segment they are
// distinct URLs and the ambiguity is gone.
//
// Returns the page's own key, not the slug, so the page's existing
// comparisons (`tab === 'perf_insights'`) keep working. nav/sections.js holds
// the mapping; see the note there on why the two names differ.
//
// An unknown screen falls back to the section's default rather than rendering
// nothing. Deliberate: these URLs are typed and shared, and a typo should land
// you somewhere rather than on a blank page.
export function useScreen(sectionKey) {
  const section = SECTIONS[sectionKey];
  if (!section) throw new Error(`useScreen: no section '${sectionKey}'`);

  const { id, screen } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const tab = (screen && tabForSlug(section, screen)) || section.defaultTab;

  // replace, not push, so walking a section does not fill the back button
  // with every screen you glanced at — the same behaviour useTabParam had.
  const setTab = (next) => {
    const slug = slugForTab(section, next);
    if (!slug) return;                       // a key this section does not have
    navigate(`${section.base(id)}/${slug}${location.search}`, { replace: true });
  };

  return [tab, setTab];
}

// Every slug a section serves, for the route guard and the tests.
export function screenSlugs(sectionKey) {
  return slugsOf(SECTIONS[sectionKey]);
}

import { useEffect } from 'react';
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

  // An unknown slug falls back to the default tab, above, which is right. What
  // was wrong is that it then RENDERED the default under the wrong URL, with
  // the default's row lit in the panel as though you had asked for it.
  //
  // Measured on 9 November: /clients/c1/produce/nonsense, /produce/review and
  // /produce/video all drew the composition editor with "Studio" lit. The
  // second one is the worst of the three, because `review` is nearly the slug
  // of a real screen (`batch-review`), so a typo or a link written from memory
  // put you in a video editor while the nav insisted that was the request.
  // drives/drive-studio.mjs warns about exactly this in its own header and
  // then only tested the slugs that work.
  //
  // So the URL is corrected to the canonical one instead, with `replace` so
  // the bad address leaves no history entry. This also means a renamed row's
  // old slug now redirects rather than silently resolving: /produce/compose
  // becomes /produce/studio in the address bar.
  //
  // It cannot loop: the canonical slug resolves to the tab whose canonical
  // slug it is. A bare section URL with no screen segment is left alone,
  // because nothing is lying there.
  const canonical = slugForTab(section, tab);
  useEffect(() => {
    if (!screen || !canonical || screen === canonical) return;
    navigate(`${section.base(id)}/${canonical}${location.search}`, { replace: true });
  }, [screen, canonical, section, id, location.search, navigate]);

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

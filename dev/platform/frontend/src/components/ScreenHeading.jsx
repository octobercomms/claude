import React from 'react';
import { useLocation } from 'react-router-dom';
import { sectionForPath, labelForTab } from '../nav/sections';

// The screen's own name, under the section title.
//
// The tab strips used to say which screen you were on. The section panel says
// it too, but 170px away and in a list of 27, which is easy to lose track of —
// Daniel asked for the name back on the page itself.
//
// Derived from the route and the panel's own row list rather than passed in,
// so no page can forget it and none can disagree with the row that opened it.
// It renders nothing when the row's name would only repeat the title above it
// ("Convert / Convert" helps nobody), or on a route with no section.
//
//   title — the section heading this sits under, so the repeat can be caught
//   name  — an override, for a screen the panel does not name
export default function ScreenHeading({ title, name }) {
  const location = useLocation();
  const section = sectionForPath(location.pathname);
  const rowLabel = labelForTab(section, new URLSearchParams(location.search).get('tab'));
  const screen = name || rowLabel;
  if (!screen || screen === title) return null;
  return <h2 className="h2 ds-shell__screen">{screen}</h2>;
}

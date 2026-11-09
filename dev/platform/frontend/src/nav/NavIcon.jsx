import React from 'react';

/**
 * The navigation's icon vocabulary.
 *
 * It exists because a screen can ask the shell to get out of the way: the
 * Studio collapses the rail and the section panel to 56px strips, and a 56px
 * strip of text is not a navigation. Daniel, 9 November: "collapse the rail
 * and panel to icons on this screen."
 *
 * The style is taken from the Studio mockup rather than invented beside it —
 * `docs/omi/briefs/produce-studio-mockup.html` draws its eight library tabs
 * as 24-unit line glyphs at 1.5 stroke with no fill, and seven of the names
 * below are its own paths. The rest are drawn to match, so the two cannot
 * drift into two vocabularies.
 *
 * A row with no icon here is NOT a blank square: `SectionPanel` and the rail
 * fall back to the row's first letter, so nothing can become unreachable by
 * forgetting a glyph. Every icon is also `aria-hidden`, with the row's real
 * label carried beside it for a screen reader and in a `title` for a mouse.
 */

const P = {
  // ── From the mockup, verbatim ──────────────────────────────────────
  library: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></>,
  audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  transcribe: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h2M10 12h2M14 12h2" /></>,
  design: <><circle cx="13.5" cy="6.5" r="2.5" /><path d="M17 15H7l3-4 2 2.5 3-3.5z" /><rect x="3" y="3" width="18" height="18" rx="2" /></>,
  visualise: <path d="M12 3l1.5 4.5H18l-3.5 3 1.5 4.5L12 12l-4 3 1.5-4.5L6 7.5h4.5z" />,
  record: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" /></>,
  text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,

  // ── Drawn to match ────────────────────────────────────────────────
  compose: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></>,
  batch: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 13h7M9 17h7" /></>,
  batch_review: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M9 2h6v4H9zM8.5 13l2.5 2.5 4.5-5" /></>,

  clients: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 9.5a2.8 2.8 0 100-5M18 20c0-2.6-1.2-4.4-3-5.2" /></>,
  workspace: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  dashboard: <><path d="M4 19V11M10 19V5M16 19v-6M21 19H3" /></>,
  paid: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  earned: <><rect x="3" y="5" width="14" height="15" rx="1.5" /><path d="M17 9h3a1 1 0 011 1v8a2 2 0 01-2 2M6 9h8M6 13h8M6 17h5" /></>,
  shared: <><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.4 10.8l7.2-4.2M8.4 13.2l7.2 4.2" /></>,
  owned: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z" /></>,
  convert: <path d="M3 5h18l-7 8v7l-4-2.5V13z" />,
  produce: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.4 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.2a1.6 1.6 0 001.4-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H11a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.2a1.6 1.6 0 001 1.4 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V11a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.2a1.6 1.6 0 00-1.4 1z" /></>,
  database: <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  bizdev: <><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M2.5 12h19" /></>,
  accounts: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
  guide: <><path d="M4 4.5A2.5 2.5 0 016.5 2H20v16H6.5A2.5 2.5 0 004 20.5z" /><path d="M4 20.5A2.5 2.5 0 016.5 18H20v4H6.5A2.5 2.5 0 014 20.5z" /></>,
};

export function hasNavIcon(name) {
  return Object.prototype.hasOwnProperty.call(P, name);
}

export default function NavIcon({ name, size = 18 }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </svg>
  );
}

// Opening one record from a URL.
//
// Search used to land you on the screen that lists a record and leave you to
// find it. That is fine for a list of six and useless for a list of two
// hundred, which is the case the search box exists for.
//
// One convention: `?open=<id>` on a screen's own URL. The path already says
// which screen, and a screen holds one kind of record, so the id needs no type
// beside it — `/clients/:id/pr/releases?open=<release id>` can only mean a
// release.
//
// Screens answer it in one of two ways, because they are not all the same:
//
//   **Open it.** Contacts, releases, coverage, campaigns and transcripts each
//   have a view of a single record. The screen opens that view. Four of the
//   five fetch by id, so the record does not have to be in the loaded list,
//   on the first page, or past the current filter.
//
//   **Reveal it.** Recordings and assets have no single-record view — a
//   recording row is rename, copy link, export, send to edit, and an asset is
//   a card. There is nothing to open, so the row is scrolled to and marked for
//   a few seconds. Where it is genuinely not in the list, `missing` says so,
//   rather than the screen doing nothing and looking broken.
//
// The parameter is cleared as soon as it has been acted on. Leaving it would
// mean closing the record reopens it on the next render, and Back landing you
// on the same record you just left.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const OPEN_PARAM = 'open';

// The id in `?open=`, and a way to drop it.
//
// `clear` uses replace rather than push, so the address bar stops naming a
// record that is no longer open without adding a history entry that Back would
// have to step through.
export function useOpenParam() {
  const location = useLocation();
  const navigate = useNavigate();
  const openId = new URLSearchParams(location.search).get(OPEN_PARAM) || null;

  const clear = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(OPEN_PARAM)) return;
    params.delete(OPEN_PARAM);
    const qs = params.toString();
    navigate(window.location.pathname + (qs ? `?${qs}` : ''), { replace: true });
  }, [navigate]);

  return { openId, clear };
}

// Run `open(id)` once for the id in the URL, then clear it.
//
// `ready` holds it back until the screen can act — usually until the right tab
// is showing, since one page renders several screens and only one of them owns
// the parameter. The ref is what makes it once: without it, clearing the
// parameter re-renders, and anything that reopened on each render would fight
// the user closing it.
export function useOpenOnce(open, ready = true) {
  const { openId, clear } = useOpenParam();
  const done = useRef(null);

  useEffect(() => {
    if (!openId || !ready || done.current === openId) return;
    done.current = openId;
    open(openId);
    clear();
  }, [openId, ready, open, clear]);
}

const REVEAL_MS = 2400;

// Scroll to a row and mark it, for the screens with nothing to open.
//
// The row marks itself with `data-open-id`; this finds it rather than being
// handed a ref per row, because the lists it runs over render their rows in
// several places and threading a ref through each would be more code in those
// files than the feature is worth.
//
// Returns `missing: true` once the list has loaded and holds no such row — a
// deleted record, or one behind a filter the viewer set. The screen says so;
// silence would read as the link being broken.
export function useRevealRow(items, loaded = Array.isArray(items)) {
  const { openId, clear } = useOpenParam();
  const [missing, setMissing] = useState(false);
  const done = useRef(null);

  useEffect(() => {
    if (!openId || !loaded || !Array.isArray(items) || done.current === openId) return;
    done.current = openId;
    if (!items.some(x => String(x.id) === String(openId))) {
      // `loaded` rather than `items.length`, so a deep link into a library
      // that is genuinely empty still says the record is not there instead of
      // waiting forever for a list that has already arrived.
      setMissing(true);
      clear();
      return;
    }
    setMissing(false);
    // After paint, or the row is not in the DOM to scroll to yet.
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-open-id="${CSS.escape(String(openId))}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('is-revealed');
        setTimeout(() => el.classList.remove('is-revealed'), REVEAL_MS);
      }
      clear();
    }, 0);
    return () => clearTimeout(t);
  }, [openId, items, loaded, clear]);

  return { missing, dismissMissing: () => setMissing(false) };
}

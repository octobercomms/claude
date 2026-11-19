import { renderFilm, buildEvents, loadFonts, DUR } from './film.js';
import * as T from './story.js';

const cv = document.getElementById('c'), g = cv.getContext('2d');
await Promise.all([document.fonts.load('600 40px LSpartan'), document.fonts.load('400 40px LGothic')]);
await loadFonts();

// the briefing's own lengths, so the subtitle strip holds exactly as long as the line
const dur = await (await fetch('voices/dur.json')).json();
T.VO.forEach(v => {
  v.dur = dur[v.id] || 2.0;
  // the longer of: the line as spoken plus a breath, and the time it takes to read
  v.hold = Math.max(v.dur + 0.6, v.sub.length / 15 + 1.5, 1.8);
});

const off = document.createElement('canvas');
off.width = cv.width; off.height = cv.height;
const og = off.getContext('2d');

const Q = new URLSearchParams(location.search);
window.DUR = DUR;
window.EV = buildEvents();
window.SUBS = T.VO.map(v => ({ t0: v.t, t1: v.t + v.hold, text: v.sub }));
window.render = t => { renderFilm(g, t, { nosub: Q.has('nosub') }); };
window.TEXTS = t => renderFilm(og, t, { collect: true, nosub: Q.has('nosub') });
window.READY = true;

import { renderFilm, buildEvents, DUR } from './film.js';

const cv = document.getElementById('c'), g = cv.getContext('2d');
await Promise.all(['400', '500', '600', '700'].map(w => document.fonts.load(`${w} 40px Archivo`)));

const off = document.createElement('canvas');
off.width = cv.width;
off.height = cv.height;
const og = off.getContext('2d');

window.DUR = DUR;
window.EV = buildEvents();
window.render = t => { renderFilm(g, t); };
window.TEXTS = t => renderFilm(og, t, { collect: true });
window.READY = true;

import { renderFilm, setFilm, setImages, buildEvents, subs } from './film.js';

const cv = document.getElementById('c'), g = cv.getContext('2d');

await Promise.all([
  document.fonts.load('400 40px Archivo'), document.fonts.load('600 40px Archivo'),
  document.fonts.load('700 40px Archivo'), document.fonts.load('400 40px PlexMono'),
  document.fonts.load('600 40px PlexMono'), document.fonts.load('italic 400 40px SourceSerif'),
]);

const film = await (await fetch('film.json')).json();
setFilm(film);

const NAMES = {
  b1: 'raw/b1-1.png', b2: 'raw/b2-2.png', b6: 'raw/b6-6.png',
  a4: 'raw/a4-04.png', a5: 'raw/a5-05.png', a18: 'raw/a18-18.png',
};
const imgs = {};
await Promise.all(Object.entries(NAMES).map(([k, src]) => new Promise(res => {
  const im = new Image();
  im.onload = () => { imgs[k] = im; res(); };
  im.onerror = () => { res(); };
  im.src = src;
})));
setImages(imgs);

const off = document.createElement('canvas');
off.width = cv.width;
off.height = cv.height;
const og = off.getContext('2d');

const Q = new URLSearchParams(location.search);
window.DUR = film.dur;
window.EV = buildEvents();
window.SUBS = subs();
window.SUBCHECK = () => subs().map(s => ({ ...s, w: (og.font = '700 34px Archivo', og.measureText(s.text).width) }));
window.render = t => { renderFilm(g, t, { nosub: Q.has('nosub') }); };
window.TEXTS = t => renderFilm(og, t, { collect: true, nosub: Q.has('nosub') });
window.READY = true;

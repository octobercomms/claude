import * as THREE from 'three';
import { build, renderFilm, buildEvents, DUR } from './film.js';

const cv = document.getElementById('c');
await Promise.all([
  document.fonts.load('400 48px AntonEn'), document.fonts.load('400 48px TypeEn'),
  document.fonts.load('700 48px TypeEn'), document.fonts.load('700 48px NewsEn'),
]);

const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
build(renderer);

window.DUR = DUR;
window.EV = buildEvents();
window.render = t => { renderFilm(t); };
window.TEXTS = t => renderFilm(t, { collect: true });
window.READY = true;

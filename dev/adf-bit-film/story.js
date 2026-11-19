// One source of timing. 120 BPM, 30 fps: a beat is exactly 15 frames, a bar 60.
export const BPM = 120, BEAT = 0.5, BAR = 2.0;
export const bar = n => (n - 1) * BAR;

// Every shot is a hard cut on a beat. t0 is when the cut happens.
export const SHOTS = [
  { id: 'hook',    t0: 0.0 },
  { id: 'screen',  t0: 7.0 },
  { id: 'number',  t0: 12.0 },
  { id: 'rates',   t0: 15.0 },
  { id: 'printer', t0: 19.0 },
  { id: 'page',    t0: 24.0 },
  { id: 'banners', t0: 27.0 },
  { id: 'social',  t0: 31.0 },
  { id: 'guide',   t0: 34.0 },
  { id: 'cal',     t0: 38.0 },
  { id: 'price',   t0: 45.0 },
  { id: 'desks',   t0: 50.0 },
];
export const DUR = 58.0;
export const shotAt = t => { let s = SHOTS[0]; for (const x of SHOTS) if (t >= x.t0) s = x; return s; };
export const shotEnd = id => { const i = SHOTS.findIndex(s => s.id === id); return i + 1 < SHOTS.length ? SHOTS[i + 1].t0 : DUR; };

// An inversion strike is one or two frames at an impact, never decoration.
export const STRIKES = [0.5, 12.0, 42.4, 45.0];

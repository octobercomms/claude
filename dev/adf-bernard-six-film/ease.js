// Two curves only, as the style allows: the precise ease cubic-bezier(.7,0,.2,1) for snaps, linear for
// lines being drawn and for the exception. No overshoot, no spring, no bounce.

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export function cubicBezier(x1, y1, x2, y2) {
  const bx = u => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3;
  const by = u => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3;
  return t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 30; i++) {
      const x = bx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return by(u);
  };
}

export const E = cubicBezier(0.7, 0, 0.2, 1);

export const BPM = 120, BEAT = 60 / BPM, E8 = BEAT / 2, E16 = BEAT / 4, BAR = BEAT * 4;

// Lands exactly at t1, starting d earlier: a snap arrives on the beat.
export const snap = (t, t1, d = E8) => E(seg(t, t1 - d, t1));

// Stepped climb, one module at a time.
export function steps(t, a, b, n) {
  const p = seg(t, a, b) * n, i = Math.floor(p);
  return i >= n ? 1 : (i + E(p - i)) / n;
}

// Keyed track of snaps: [[t_arrive, value, dur?], ...]; value may be a number or an array.
export function track(keys) {
  return t => {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, d = E8] = keys[i];
      if (t < t1 - d) break;
      const p = snap(t, t1, d);
      v = Array.isArray(v1) ? v1.map((x, j) => lerp(v[j], x, p)) : lerp(v, v1, p);
      if (p < 1) break;
    }
    return v;
  };
}

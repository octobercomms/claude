// One source of timing for the picture, the score and the subtitles.
// 144 BPM so a beat is exactly 10 frames at 24 fps: every stab lands on a whole frame.

export const BPM = 144;
export const BEAT = 60 / BPM;            // 0.416667 s = 10 frames
export const BAR = BEAT * 4;             // 1.666667 s = 40 frames
export const bar = n => (n - 1) * BAR;
export const beat = n => n * BEAT;

export const SEC = {
  assign: bar(1),    // the package lands, the assignment is read
  list: bar(7),      // a column of names, descended
  inbox: bar(14),    // push into the O; one edition on the table
  net: bar(20),      // three sites, a lateral run
  guide: bar(25),    // the page that stays standing
  price: bar(30),    // stop-time, then the number
  hand: bar(35),     // the hand-off
  title: bar(39),    // the pieces assemble
};
export const END = bar(43);
export const DUR = END;

// Edit points. Every one of these is a brass stab in the mix and a hard cut in the picture.
export const STABS = [bar(2), bar(7), bar(14), bar(20), bar(25), bar(30), bar(35), bar(39)];

// Stop-time: the picture freezes and the band stops dead.
export const FREEZE = { t0: bar(30), t1: bar(32) };

// The briefing, placed in the gaps between stabs, never over one.
export const VO = [
  { id: 'v1', t: 11.5, sub: '8,911 people who specify, buy and recommend.' },
  { id: 'v2', t: 23.5, sub: 'One edition. Your subject. Nobody else in it.' },
  { id: 'v3', t: 32.8, sub: 'Three sites. A full quarter of display.' },
  { id: 'v4', t: 41.2, sub: 'A guide that keeps working after the quarter closes.' },
  { id: 'v5', t: 51.5, sub: '$2,500. Four slots in the year.' },
  { id: 'v6', t: 58.0, sub: 'One sponsor. One quarter.' },
];

export const secAt = t => {
  const ks = Object.keys(SEC);
  let cur = ks[0];
  for (const k of ks) if (t >= SEC[k]) cur = k;
  return cur;
};

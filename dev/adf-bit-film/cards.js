// Every word in this film is printed on a surface in the world. These are those surfaces: text
// drawn large on its own canvas, then dithered with the object it is on.
// Each card returns { tex, lines } so the reading check can see where its text sits.
import * as THREE from 'three';
import { canvasTex, paperCanvas, printMat } from './kit.js';

const PAPER = '#ffffff';

function card(w, h, draw, o = {}) {
  const pc = paperCanvas(w, h, draw, o.bg || PAPER);
  const tex = canvasTex(pc.canvas, { mip: true });
  return { tex, lines: pc.lines, w, h, mat: printMat(tex, { text: true, bias: o.bias ?? 0.56, side: THREE.DoubleSide }) };
}

// ---------------------------------------------------------------- 01 the hook, stamped
export const hookCard = () => card(2048, 1152, (g, put) => {
  put('h1', 'YOUR BRAND', 120, 330, 'anton', 190);
  put('h2', 'IN FRONT OF THE PEOPLE', 120, 500, 'anton', 150);
  put('h3', 'WHO SPECIFY AND BUY', 120, 650, 'anton', 150);
  g.fillRect(120, 720, 1700, 10);
  put('h4', 'ONE QUARTER OF THE YEAR', 120, 860, 'type', 92, { weight: 700 });
  put('h5', 'ATLANTA AND THE SOUTHEAST', 120, 980, 'type', 92, { weight: 700 });
});

// ---------------------------------------------------------------- 02 the list, on a screen
export const listCard = rows => card(1024, 1024, (g, put) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 96);
  put('lt', 'THE LIST', 40, 68, 'type', 54, { weight: 700, color: '#fff' });
  const names = ['ARCHITECTS', 'INTERIOR DESIGNERS', 'SPECIFIERS',
    'BUILDERS', 'SHOWROOMS AND REPS', 'PRESS AND EDITORS'];
  for (let i = 0; i < Math.min(rows, names.length); i++) {
    put(`ln${i}`, names[i], 40, 200 + i * 128, 'type', 62, { weight: 700, fit: 940 });
    g.fillRect(40, 226 + i * 128, 944, 4);
  }
}, { bias: 0.5 });

export const bigCard = (big, small, sub) => card(1400, 900, (g, put) => {
  put('bg', big, 70, 420, 'anton', 320, { fit: 1260 });
  put('bs', small, 70, 540, 'type', 76, { weight: 700 });
  if (sub) put('bu', sub, 70, 640, 'type', 50);
});

export const ratesCard = () => card(1800, 900, (g, put) => {
  const col = [['39%', 'AVERAGE OPEN'], ['19%', 'AVERAGE CLICK'], ['0.2%', 'UNSUBSCRIBE']];
  col.forEach(([a, b], i) => {
    const x = 70 + i * 580;
    put(`ra${i}`, a, x, 420, 'anton', 230, { fit: 520 });
    put(`rb${i}`, b, x, 520, 'type', 60, { weight: 700, fit: 520 });
    g.fillStyle = '#000';
    g.fillRect(x, 560, 520, 8);
  });
  put('rc', 'THE TRADE AVERAGE IS NEAR 21%. THE LIST DOES NOT CHURN.', 70, 720, 'type', 56, { weight: 700, fit: 1660 });
});

// ---------------------------------------------------------------- the edition
export const editionCard = linesShown => card(1024, 1448, (g, put) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 120);
  put('et', 'INDUSTRY RESOURCES', 44, 82, 'news', 62, { weight: 700, color: '#fff' });
  put('eh', 'ONE SPONSOR.', 44, 240, 'anton', 120);
  put('eh2', 'ONE SUBJECT.', 44, 360, 'anton', 120);
  put('eh3', 'NOBODY ELSE IN IT.', 44, 480, 'anton', 120, { fit: 936 });
  // the body is a page to recognise, not to read: printed rules, line by line
  for (let i = 0; i < linesShown; i++) {
    const y = 600 + i * 46;
    if (y > 1360) break;
    g.fillStyle = '#000';
    g.fillRect(44, y, [880, 820, 936, 760, 900, 840, 700, 920][i % 8], 16);
  }
}, { bias: 0.5 });

export const bannerCard = (size, place) => card(900, 420, (g, put) => {
  put('bz', size, 50, 190, 'anton', 150, { fit: 800 });
  put('bp', place, 50, 290, 'type', 62, { weight: 700, fit: 800 });
  g.fillRect(50, 320, 800, 8);
}, { bias: 0.52 });

export const socialCard = (n, label, line) => card(760, 760, (g, put) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 760, 92);
  put('sn', n, 34, 66, 'type', 54, { weight: 700, color: '#fff' });
  put('sl', label, 34, 230, 'anton', 108, { fit: 690 });
  put('s1', line, 34, 330, 'type', 46, { weight: 700 });
  g.fillStyle = '#000';
  for (let i = 0; i < 7; i++) g.fillRect(34, 400 + i * 46, [640, 560, 690, 500, 610, 540, 420][i], 14);
}, { bias: 0.5 });

export const guideCard = () => card(1024, 1448, (g, put) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 120);
  put('gt', 'THE GUIDE', 44, 84, 'news', 66, { weight: 700, color: '#fff' });
  put('gh', 'IT KEEPS WORKING', 44, 250, 'anton', 118, { fit: 936 });
  put('gh2', 'AFTER THE QUARTER', 44, 370, 'anton', 118, { fit: 936 });
  put('gh3', 'CLOSES.', 44, 490, 'anton', 118);
  put('gl', 'HOSTED BY US. YOUR NAME ON IT.', 44, 600, 'type', 52, { weight: 700 });
  for (let i = 0; i < 14; i++) {
    g.fillStyle = '#000';
    g.fillRect(44, 680 + i * 46, [880, 820, 936, 760, 900][i % 5], 14);
  }
}, { bias: 0.5 });

export const calCard = () => card(1600, 900, (g, put) => {
  put('ct', 'FOUR SLOTS A YEAR', 60, 130, 'anton', 150, { fit: 1480 });
  put('cs', 'ONE SPONSOR IN EACH', 60, 220, 'type', 66, { weight: 700 });
  const q = [['Q1', 'FEBRUARY'], ['Q2', 'MAY'], ['Q3', 'AUGUST'], ['Q4', 'NOVEMBER']];
  q.forEach(([a, b], i) => {
    const x = 60 + i * 385;
    g.fillStyle = '#000';
    g.fillRect(x, 300, 350, 10);
    put(`q${i}`, a, x, 450, 'anton', 130);
    put(`qm${i}`, b, x, 540, 'type', 54, { weight: 700 });
  });
}, { bias: 0.52 });

export const priceCard = () => card(1600, 900, (g, put) => {
  put('pz', '$2,500', 70, 400, 'anton', 330, { fit: 1460 });
  g.fillRect(70, 450, 1460, 12);
  put('p1', '2027 FOUNDING RATE', 70, 570, 'type', 74, { weight: 700 });
  put('p2', '$5,000 FROM 2028', 70, 670, 'type', 74, { weight: 700 });
  put('p3', 'ONE CAMPAIGN. EMAIL, DISPLAY, SOCIAL, GUIDE.', 70, 770, 'type', 52);
});

export const stampCard = text => card(1100, 320, (g, put) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1100, 320);
  put('st', text, 550, 205, 'anton', 150, { fit: 1000, align: 'center', color: '#fff' });
}, { bias: 0.5, bg: '#000000' });

export const endCard = () => card(2048, 1152, (g, put) => {
  put('e1', 'INDUSTRY', 120, 330, 'anton', 230);
  put('e2', 'RESOURCES 2027', 120, 560, 'anton', 230, { fit: 1800 });
  g.fillRect(120, 630, 1800, 10);
  put('e3', 'ONE SPONSOR A QUARTER', 120, 770, 'type', 96, { weight: 700, fit: 1800 });
  put('e4', 'ATLANTA AND THE SOUTHEAST', 120, 900, 'type', 96, { weight: 700, fit: 1800 });
  put('e5', 'ATLANTADESIGNFESTIVAL.ORG', 120, 1040, 'type', 76, { weight: 700, fit: 1800 });
});

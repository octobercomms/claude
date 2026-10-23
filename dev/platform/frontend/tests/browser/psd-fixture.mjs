// A PSD that reproduces what October's real Adobe Express exports do.
//
// Every oddity here was observed in an actual exported file, not invented:
// a carriage-return line break, a wordmark exported as one vector shape per
// letter nested three groups deep, a layer mask, a reported font size that is
// 4/3 of the truth, a text layer with no reported size at all, a hidden layer,
// and layer effects. Written with imageData rather than a canvas so the test
// needs no native image library on the CI runner.
import { writePsdBuffer } from 'ag-psd';
import fs from 'node:fs';

const img = (w, h, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a; }
  return { width: w, height: h, data };
};
// a mask that keeps only the left half
const maskHalf = (w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = x < w / 2 ? 255 : 0;
    data[i] = v; data[i+1] = v; data[i+2] = v; data[i+3] = 255;
  }
  return { width: w, height: h, data };
};

const glyph = (x) => ({
  name: 'Custom Shape', left: x, top: 774, right: x + 22, bottom: 797,
  imageData: img(22, 23, [255, 255, 255]),
});

const psd = {
  width: 1080, height: 1350,
  children: [
    { name: 'Layer 0', left: 0, top: 0, right: 1080, bottom: 1350,
      imageData: img(1080, 1350, [90, 120, 70]),
      effects: { dropShadow: [{ enabled: true }] } },
    { name: 'Rectangle', left: 0, top: 899, right: 1080, bottom: 1350,
      imageData: img(1080, 451, [0, 0, 0]), opacity: 0.35 },
    { name: 'Hidden thing', left: 0, top: 0, right: 100, bottom: 100,
      imageData: img(100, 100, [255, 0, 0]), hidden: true },
    // a masked layer: full rectangle, half of it cut away
    { name: 'Raster 4', left: 60, top: 429, right: 287, bottom: 658,
      imageData: img(227, 229, [200, 30, 30]),
      mask: { left: 60, top: 429, right: 287, bottom: 658, imageData: maskHalf(227, 229), defaultColor: 0 } },
    // a wordmark exported as one shape per letter, nested three groups deep
    { name: 'Group', opened: false, children: [
      { name: 'Group', opened: false, children: [
        { name: 'Group', opened: false, children:
          [88, 113, 137, 161, 186, 218, 243].map(glyph) },
      ] },
    ] },
    // a carriage-return line break, and a reported size that is 4/3 too big
    { name: 'ARCHITECTURE TOUR: LAKE OCONEE', left: 89, top: 889, right: 783, bottom: 1034,
      text: { text: 'ARCHITECTURE TOUR:\rLAKE OCONEE',
        style: { font: { name: 'GTAmerica-Bold' }, fontSize: 86.66666, fillColor: { r: 254, g: 254, b: 254 } },
        paragraphStyle: { justification: 'left' } } },
    // the size=null case from ADF 2026-39
    { name: 'MA! ARCHITECTURE TOURS', left: 60, top: 57, right: 749, bottom: 319,
      text: { text: 'MA! ARCHITECTURE TOURS: ATLANTA\r\rCOMMERCIAL GUIDED TOURS',
        style: { font: { name: 'GTAmerica-Bold' }, fillColor: { r: 254, g: 254, b: 254 } } } },
  ],
};

fs.writeFileSync(process.argv[2] || 'fixture.psd', Buffer.from(writePsdBuffer(psd)));
console.log('written', process.argv[2] || 'fixture.psd');

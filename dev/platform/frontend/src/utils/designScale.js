// Rescale a saved scene when a set changes size.
//
// Everything is scaled by the smaller of the two ratios and centred, so the
// artwork keeps its proportions and nothing is cropped. That is deliberately a
// starting point and not a re-layout: taking a square to a story leaves bands
// of space that only a person can decide what to do with, and a clever
// automatic answer would quietly wreck the design instead of obviously
// leaving room.
//
// Text is the one thing not scaled by scaleX/scaleY. A text layer carries a
// real font size and box width, and the editor's panel reads them; scaling the
// object instead would leave the panel saying 92 while the headline rendered
// at 46, which is the same lie the PSD importer had to be taught not to tell.

export function scaleFor(from, to) {
  const s = Math.min(to.width / from.width, to.height / from.height);
  return {
    scale: s,
    dx: (to.width - from.width * s) / 2,
    dy: (to.height - from.height * s) / 2,
  };
}

export function rescaleScene(scene, from, to) {
  if (!scene || !Array.isArray(scene.objects)) return scene;
  if (!(from.width > 0) || !(from.height > 0) || !(to.width > 0) || !(to.height > 0)) return scene;
  const { scale, dx, dy } = scaleFor(from, to);
  if (scale === 1 && dx === 0 && dy === 0) return scene;

  return {
    ...scene,
    objects: scene.objects.map((o) => {
      const next = {
        ...o,
        left: (o.left || 0) * scale + dx,
        top: (o.top || 0) * scale + dy,
      };
      if (typeof o.fontSize === 'number') {
        next.fontSize = o.fontSize * scale;
        next.width = (o.width || 0) * scale;
        // Any scale already on the layer is folded into the size, so the
        // panel keeps telling the truth about what is on the page.
        next.scaleX = 1;
        next.scaleY = 1;
        if (typeof o.strokeWidth === 'number') next.strokeWidth = o.strokeWidth * scale;
        return next;
      }
      next.scaleX = (o.scaleX === undefined ? 1 : o.scaleX) * scale;
      next.scaleY = (o.scaleY === undefined ? 1 : o.scaleY) * scale;
      if (typeof o.strokeWidth === 'number') next.strokeWidth = o.strokeWidth * scale;
      return next;
    }),
  };
}

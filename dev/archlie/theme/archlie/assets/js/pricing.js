/* ============================================================
   Archlie — pricing model (front-end).

   In WordPress the model is localised from PHP as window.ARCHLIE_WP
   (single source of truth in inc/pricing.php). If it's absent — e.g.
   the file is opened standalone — sensible defaults are used instead.
   ============================================================ */
window.ARCHLIE = (function () {
  'use strict';

  var WP = window.ARCHLIE_WP || null;

  var DEFAULTS = {
    services: {
      planning:        { label: 'Planning application drawings', A: 950,  B: 1350, C: 1850, kind: 'service' },
      buildingcontrol: { label: 'Building control drawings',     A: 850,  B: 1200, C: 1650, kind: 'service' },
      permitted:       { label: 'Permitted development drawings',A: 750,  B: 950,  C: 1250, kind: 'service' },
      listed:          { label: 'Listed building consent',       A: 1200, B: 1600, C: 2200, kind: 'service' },
      concept:         { label: 'Concept design + 3D visual',    A: 400,  B: 600,  C: 900,  kind: 'addon' }
    },
    survey: { A: { std: 320, london: 420 }, B: { std: 380, london: 495 }, C: { std: 460, london: 560 } },
    bands:  { A: 'Band A · up to 50m²', B: 'Band B · 50–100m²', C: 'Band C · 100–150m²' },
    redirect: { feeOver: 3500, areaOverBand: true },
    revisionsIncluded: 2,
    deliveryDays: '3–7 working days',
    quoteValidityDays: 30
  };

  var M = WP || DEFAULTS;

  function money(n) { return '£' + Number(n).toLocaleString('en-GB'); }

  return {
    SERVICES: M.services,
    SURVEY: M.survey,
    BANDS: M.bands,
    REDIRECT: M.redirect,
    REVISIONS_INCLUDED: M.revisionsIncluded,
    DELIVERY_DAYS: M.deliveryDays,
    QUOTE_VALIDITY_DAYS: M.quoteValidityDays,
    // WordPress-only wiring (undefined on the static site)
    AJAX_URL: WP ? WP.ajaxUrl : null,
    NONCE: WP ? WP.nonce : null,
    money: money
  };
})();

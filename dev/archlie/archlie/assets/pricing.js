/* ============================================================
   Archlie — pricing model (single source of truth)

   Confirmed indicative prices from Brief v3 §5. Tiam adjusts per
   actual time-cost before launch. Both the homepage price table and
   the AI onboarding package builder read from this one object.
   ============================================================ */
window.ARCHLIE = (function () {
  'use strict';

  // Fixed drawing-package prices by service and floor-area band (GBP).
  var SERVICES = {
    planning:        { label: 'Planning application drawings', A: 950,  B: 1350, C: 1850, kind: 'service' },
    buildingcontrol: { label: 'Building control drawings',     A: 850,  B: 1200, C: 1650, kind: 'service' },
    permitted:       { label: 'Permitted development drawings',A: 750,  B: 950,  C: 1250, kind: 'service' },
    listed:          { label: 'Listed building consent',       A: 1200, B: 1600, C: 2200, kind: 'service' },
    concept:         { label: 'Concept design + 3D visual',    A: 400,  B: 600,  C: 900,  kind: 'addon' }
  };

  // Measured-survey banded rates (added on top when Archlie arranges the survey).
  // London rates apply where the address is confirmed in London.
  var SURVEY = {
    A: { std: 320, london: 420 },
    B: { std: 380, london: 495 },
    C: { std: 460, london: 560 }
  };

  var BANDS = {
    A: 'Band A · up to 50m²',
    B: 'Band B · 50–100m²',
    C: 'Band C · 100–150m²'
  };

  // Redirect-to-Tiam thresholds (Brief v3 §5).
  var REDIRECT = {
    feeOver: 3500,     // estimated package fee
    areaOverBand: true // over 150m² (no band) always redirects
  };

  var REVISIONS_INCLUDED = 2;
  var DELIVERY_DAYS = '3–7 working days';
  var QUOTE_VALIDITY_DAYS = 30;

  function money(n) {
    return '£' + Number(n).toLocaleString('en-GB');
  }

  return {
    SERVICES: SERVICES,
    SURVEY: SURVEY,
    BANDS: BANDS,
    REDIRECT: REDIRECT,
    REVISIONS_INCLUDED: REVISIONS_INCLUDED,
    DELIVERY_DAYS: DELIVERY_DAYS,
    QUOTE_VALIDITY_DAYS: QUOTE_VALIDITY_DAYS,
    money: money
  };
})();

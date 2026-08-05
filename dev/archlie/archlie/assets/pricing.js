/* ============================================================
   Your Architect — pricing model (single source of truth)

   From Tiam's comments: TWO flat packages (not floor-area bands),
   a small set of add-ons, and items that are sourced separately
   (survey, structural engineer) with a quote to follow. The homepage
   pricing menu and the Archie builder both read from this one object,
   so they can never drift.
   ============================================================ */
window.ARCHLIE = (function () {
  'use strict';

  var PACKAGES = {
    planning: {
      id: 'planning',
      label: 'Planning — full package',
      price: 850,
      blurb: 'For home extensions, loft/mansard/garage conversions, outbuildings and new dwellings.',
      for: ['Home extensions', 'Loft, mansard & garage conversions', 'Outbuildings', 'New dwellings'],
      includes: [
        'Site, location & block plans',
        'Existing + proposed drawings',
        '3D concept design (up to 2 revisions)',
        'Planning application prep, submission & management',
        'Detailed Building Regulations drawings',
        'Drawing revisions',
        'Free amendments requested by the council',
        'Site visit on request (London boroughs only, additional charge)'
      ]
    },
    buildingregs: {
      id: 'buildingregs',
      label: 'Building Regs drawings',
      price: 950,
      blurb: 'For projects with planning already approved.',
      for: ['Internal alterations', 'Approved extensions', 'Loft & garage conversions', 'Outbuildings', 'New dwellings'],
      includes: [
        'Detailed Building Regulations drawings',
        'Construction details & written specification',
        'Drainage layout where required',
        'Building control submission on request',
        'Drawing revisions'
      ]
    }
  };

  // Optional add-ons (shown transparently, priced upfront).
  var ADDONS = {
    submission: { id: 'submission', label: 'We submit & manage your planning application', price: 80 },
    concept3d:  { id: 'concept3d',  label: '3D concept visual (up to 2 revisions)',        price: 250 },
    siteVisit:  { id: 'siteVisit',  label: 'Site visit (London boroughs / within the M25)', price: 350 }
  };

  // Sourced separately — a quote is shared for approval before proceeding. Never
  // part of our fee; you only pay the third party, not our time.
  var SEPARATE = {
    survey:     { id: 'survey',     label: 'Measured survey',     note: 'sourced separately — quote to follow' },
    structural: { id: 'structural', label: 'Structural engineer', note: 'sourced separately — quote to follow' }
  };

  // Full architectural service range (for the services section).
  var SERVICES = [
    'Rear, side & wraparound extensions',
    'Two-storey extensions',
    'Loft & mansard conversions',
    'Garage conversions',
    'Garden rooms & outbuildings',
    'New build homes',
    'Internal alterations & refurbishment',
    'Change of use (without construction)',
    'Pre-planning applications',
    'Planning applications',
    'Permitted development / lawful development certificate',
    'Listed building consent',
    'Retrospective applications',
    'Measured building surveys'
  ];

  var REVISIONS_INCLUDED = 2;
  var DELIVERY = 'within 7 days';           // of survey receipt / requirements confirmed
  var QUOTE_VALIDITY_DAYS = 30;
  var RIBA_EMAIL = 'info@tiamarchitects.com';

  function money(n) { return '£' + Number(n).toLocaleString('en-GB'); }

  return {
    PACKAGES: PACKAGES,
    ADDONS: ADDONS,
    SEPARATE: SEPARATE,
    SERVICES: SERVICES,
    REVISIONS_INCLUDED: REVISIONS_INCLUDED,
    DELIVERY: DELIVERY,
    QUOTE_VALIDITY_DAYS: QUOTE_VALIDITY_DAYS,
    RIBA_EMAIL: RIBA_EMAIL,
    money: money
  };
})();

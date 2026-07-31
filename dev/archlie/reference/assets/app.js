/* ============================================================
   Architects Direct — front-end logic
   1. Pricing calculator (service × band, with redirect rules)
   2. Intake form (client-side validation + friendly confirmation)

   NOTE: Prices here are INDICATIVE PLACEHOLDERS for demonstration.
   Tiam Architects sets the real figures before launch. They live in
   one table so they're trivial to swap out (or wire to WordPress later).
   ============================================================ */
(function () {
  'use strict';

  /* ---- 1. Pricing model -------------------------------------------------- */

  // Fixed price by service and floor-area band (£, GBP). Indicative only.
  var PRICES = {
    planning:        { A: 1200, B: 1800, C: 2400, label: 'Planning application' },
    buildingcontrol: { A:  900, B: 1400, C: 1900, label: 'Building control / regs' },
    permitted:       { A:  750, B: 1100, C: 1500, label: 'Permitted development' },
    tender:          { A: 1400, B: 2000, C: 2800, label: 'Tender drawings' }
  };

  var BAND_LABEL = {
    A: 'up to 50m² (Band A)',
    B: '50–100m² (Band B)',
    C: '100–150m² (Band C)',
    over: 'over 150m²'
  };

  function gbp(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var form = document.getElementById('calcForm');
  var elStandard = document.getElementById('resultStandard');
  var elRedirect = document.getElementById('resultRedirect');
  var elFigure = document.getElementById('resultFigure');
  var elSub = document.getElementById('resultSub');
  var elRedirectHeading = document.getElementById('redirectHeading');
  var elRedirectBody = document.getElementById('redirectBody');

  function getValue(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : null;
  }

  function updateCalc() {
    if (!form) return;
    var service = getValue('service');
    var band = getValue('band');
    var listed = form.querySelector('input[name="listed"]').checked;
    var ongoing = form.querySelector('input[name="ongoing"]').checked;

    // --- Redirect logic (mirrors Section 8 of the brief) ---
    // Over 150m², listed building, or ongoing project management => Tiam.
    var reasons = [];
    if (band === 'over') reasons.push('a project over 150m²');
    if (listed) reasons.push('a listed building');
    if (ongoing) reasons.push('ongoing project management');

    if (reasons.length) {
      showRedirect(reasons);
      return;
    }

    // --- Standard fixed price ---
    var svc = PRICES[service];
    var price = svc[band];
    elFigure.textContent = gbp(price);
    elSub.textContent = svc.label + ' · ' + BAND_LABEL[band];
    elStandard.hidden = false;
    elRedirect.hidden = true;
  }

  function joinReasons(reasons) {
    if (reasons.length === 1) return reasons[0];
    if (reasons.length === 2) return reasons[0] + ' and ' + reasons[1];
    return reasons.slice(0, -1).join(', ') + ' and ' + reasons[reasons.length - 1];
  }

  function showRedirect(reasons) {
    elRedirectHeading.textContent = 'This one’s a job for Tiam Architects';
    elRedirectBody.textContent =
      'You’ve told us this involves ' + joinReasons(reasons) +
      '. Work like this needs a proper conversation and a bespoke fee, so we’ll pass your details to Tiam Architects for a formal consultation.';
    elStandard.hidden = true;
    elRedirect.hidden = false;
  }

  if (form) {
    form.addEventListener('change', updateCalc);
    updateCalc(); // initialise

    // Prefill the intake form when the calculator's CTA is used.
    var syncToIntake = function () {
      var service = getValue('service');
      var band = getValue('band');
      var over = (band === 'over') || form.querySelector('input[name="listed"]').checked;
      var svcSelect = document.getElementById('f-service');
      var bandSelect = document.getElementById('f-band');
      if (svcSelect && service) svcSelect.value = service;
      if (bandSelect) bandSelect.value = over ? 'over' : band;
    };
    var resultCta = document.getElementById('resultCta');
    var redirectCta = document.getElementById('redirectCta');
    if (resultCta) resultCta.addEventListener('click', syncToIntake);
    if (redirectCta) redirectCta.addEventListener('click', syncToIntake);
  }

  /* ---- 2. Intake form ---------------------------------------------------- */

  var intake = document.getElementById('intakeForm');
  var note = document.getElementById('intakeNote');

  function setNote(msg, kind) {
    if (!note) return;
    note.textContent = msg;
    note.className = 'intake-note ' + (kind || '');
  }

  if (intake) {
    intake.addEventListener('submit', function (e) {
      e.preventDefault();

      var required = intake.querySelectorAll('[required]');
      var firstInvalid = null;
      required.forEach(function (field) {
        var ok = field.type === 'checkbox' ? field.checked : field.value.trim() !== '';
        if (field.type === 'email' && ok) {
          ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim());
        }
        field.classList.toggle('invalid', !ok);
        if (!ok && !firstInvalid) firstInvalid = field;
      });

      if (firstInvalid) {
        setNote('Please check the highlighted fields — we just need a few essentials to open your project.', 'err');
        if (firstInvalid.focus) firstInvalid.focus();
        return;
      }

      // No backend in this static build — Phase 1 wires this to the
      // WordPress intake + project-account creation. For now, confirm.
      var name = (document.getElementById('f-name').value || '').trim().split(' ')[0];
      intake.querySelector('.intake-grid').style.opacity = '0.5';
      setNote(
        'Thanks' + (name ? ', ' + name : '') + '! Your project brief is ready to send. ' +
        'In the live service this creates your project account instantly and we’d start your drawings — ' +
        'you’d only pay once you can preview the work.',
        'ok'
      );
      var submitBtn = intake.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.textContent = 'Project brief ready ✓'; submitBtn.disabled = true; }
    });

    // Clear the invalid state as the user fixes each field.
    intake.addEventListener('input', function (e) {
      if (e.target.classList.contains('invalid')) e.target.classList.remove('invalid');
    });
  }

  /* ---- 3. Footer year ---------------------------------------------------- */
  var yr = document.getElementById('year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();

/* ============================================================
   Architects Direct — front-end logic (WordPress theme)

   1. Pricing calculator (service x band, with redirect rules)
   2. Intake form -> WordPress admin-ajax (nonce-protected)

   Pricing + band labels come from window.ADData (localised in
   functions.php). If ADData is absent (e.g. opening the file
   statically), it falls back to sensible defaults and the form
   just confirms without posting.
   ============================================================ */
(function () {
  'use strict';

  var AD = window.ADData || {};

  /* ---- Pricing model (from PHP, with fallback) --------------------------- */

  var PRICES = AD.prices || {
    planning:        { label: 'Planning application',    A: 1200, B: 1800, C: 2400 },
    buildingcontrol: { label: 'Building control / regs', A:  900, B: 1400, C: 1900 },
    permitted:       { label: 'Permitted development',   A:  750, B: 1100, C: 1500 },
    tender:          { label: 'Tender drawings',         A: 1400, B: 2000, C: 2800 }
  };

  var BAND_LABEL = AD.bands || {
    A: 'up to 50m² (Band A)',
    B: '50–100m² (Band B)',
    C: '100–150m² (Band C)',
    over: 'over 150m²'
  };

  var REDIRECT_OVER = AD.redirectOverBand || 'over';

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

  function serviceLabel(key) {
    return (PRICES[key] && PRICES[key].label) || key;
  }

  function updateCalc() {
    if (!form) return;
    var service = getValue('service');
    var band = getValue('band');
    var listed = form.querySelector('input[name="listed"]').checked;
    var ongoing = form.querySelector('input[name="ongoing"]').checked;

    // Redirect logic (mirrors Section 8 of the brief):
    // over the threshold band, listed building, or ongoing management => Tiam.
    var reasons = [];
    if (band === REDIRECT_OVER) reasons.push('a project over 150m²');
    if (listed) reasons.push('a listed building');
    if (ongoing) reasons.push('ongoing project management');

    if (reasons.length) {
      showRedirect(reasons);
      return;
    }

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
    updateCalc();

    // Prefill the intake form when the calculator's CTA is used.
    var syncToIntake = function () {
      var service = getValue('service');
      var band = getValue('band');
      var over = (band === REDIRECT_OVER) || form.querySelector('input[name="listed"]').checked;
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

  function validate() {
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
    return firstInvalid;
  }

  function submitViaAjax() {
    var data = new FormData(intake);
    data.append('action', 'ad_intake');
    data.append('nonce', AD.nonce || '');
    data.append('source', 'website');

    var btn = intake.querySelector('button[type="submit"]');
    var original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Opening your project…'; }
    setNote('', '');

    fetch(AD.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: data })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        var payload = res.body || {};
        if (payload.success) {
          intake.querySelector('.intake-grid').style.opacity = '0.5';
          setNote((payload.data && payload.data.message) || 'Your project account is open.', 'ok');
          if (btn) btn.textContent = 'Project created ✓';
        } else {
          var d = payload.data || {};
          if (d.fields) {
            Object.keys(d.fields).forEach(function (name) {
              var f = intake.querySelector('[name="' + name + '"]');
              if (f) f.classList.add('invalid');
            });
          }
          setNote(d.message || 'Something went wrong. Please try again.', 'err');
          if (btn) { btn.disabled = false; btn.textContent = original; }
        }
      })
      .catch(function () {
        setNote('We couldn’t reach the server. Please check your connection and try again.', 'err');
        if (btn) { btn.disabled = false; btn.textContent = original; }
      });
  }

  function confirmStatic() {
    // No WordPress backend available (static preview) — confirm client-side.
    var name = (document.getElementById('f-name').value || '').trim().split(' ')[0];
    intake.querySelector('.intake-grid').style.opacity = '0.5';
    setNote(
      'Thanks' + (name ? ', ' + name : '') + '! Your project brief is ready to send. ' +
      'On the live site this opens your project account instantly and we’d start your drawings — ' +
      'you’d only pay once you can preview the work.',
      'ok'
    );
    var btn = intake.querySelector('button[type="submit"]');
    if (btn) { btn.textContent = 'Project brief ready ✓'; btn.disabled = true; }
  }

  if (intake) {
    intake.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstInvalid = validate();
      if (firstInvalid) {
        setNote('Please check the highlighted fields — we just need a few essentials to open your project.', 'err');
        if (firstInvalid.focus) firstInvalid.focus();
        return;
      }
      if (AD.ajaxUrl && AD.nonce) {
        submitViaAjax();
      } else {
        confirmStatic();
      }
    });

    intake.addEventListener('input', function (e) {
      if (e.target.classList.contains('invalid')) e.target.classList.remove('invalid');
    });
  }

  /* ---- 3. Footer year (static preview only; theme prints it server-side) - */
  var yr = document.getElementById('year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();

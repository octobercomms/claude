/* ============================================================
   Archlie — homepage scripting.
   Fills the pricing table and service "from" figures from the
   single pricing model (assets/pricing.js). Keeps marketing copy
   and the onboarding builder in perfect sync.
   ============================================================ */
(function () {
  'use strict';
  var A = window.ARCHLIE;
  if (!A) return;

  // --- Pricing table ---
  var tbody = document.querySelector('#priceTable tbody');
  if (tbody) {
    var order = ['planning', 'buildingcontrol', 'permitted', 'listed', 'concept'];
    var subtitle = {
      planning: 'To apply for planning permission',
      buildingcontrol: 'Once planning is in place',
      permitted: 'Lawful development certificate pack',
      listed: 'Standard consent application',
      concept: 'Optional layout / 3D visual'
    };
    order.forEach(function (key) {
      var s = A.SERVICES[key];
      if (!s) return;
      var tr = document.createElement('tr');
      if (s.kind === 'addon') tr.className = 'addon';
      tr.innerHTML =
        '<td class="svc">' + s.label + '<small>' + (subtitle[key] || '') + '</small></td>' +
        '<td class="band">' + A.money(s.A) + '</td>' +
        '<td class="band">' + A.money(s.B) + '</td>' +
        '<td class="band">' + A.money(s.C) + '</td>';
      tbody.appendChild(tr);
    });
  }

  // --- Service card "from" figures (cheapest band) ---
  document.querySelectorAll('.from[data-from]').forEach(function (el) {
    var s = A.SERVICES[el.getAttribute('data-from')];
    if (s) el.textContent = 'from ' + A.money(Math.min(s.A, s.B, s.C));
  });

  // --- Footer year ---
  var yr = document.getElementById('year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();

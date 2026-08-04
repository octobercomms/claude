/* ============================================================
   Your Architect — homepage scripting.
   Fills the three band pricing cards from the single pricing model
   (assets/pricing.js) so marketing and the builder never drift.
   ============================================================ */
(function () {
  'use strict';
  var A = window.ARCHLIE;
  if (!A) return;

  // Service order shown in each band card (add-on last).
  var ORDER = ['planning', 'buildingcontrol', 'permitted', 'listed', 'concept'];

  document.querySelectorAll('.price-card[data-band]').forEach(function (card) {
    var band = card.getAttribute('data-band');
    var rows = card.querySelector('.rows');
    if (!rows) return;
    ORDER.forEach(function (key) {
      var s = A.SERVICES[key];
      if (!s) return;
      var row = document.createElement('div');
      row.className = 'price-row';
      row.innerHTML = '<span class="svc">' + s.label.replace(' drawings', '') + '</span>' +
                      '<span class="amt">' + A.money(s[band]) + '</span>';
      rows.appendChild(row);
    });
  });

  var yr = document.getElementById('year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();

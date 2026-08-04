/* ============================================================
   Your Architect — homepage scripting.
   Fills the package prices from the single pricing model
   (assets/pricing.js) so the menu and the builder never drift.
   ============================================================ */
(function () {
  'use strict';
  var A = window.ARCHLIE;
  if (A) {
    document.querySelectorAll('[data-pkg-price]').forEach(function (el) {
      var p = A.PACKAGES[el.getAttribute('data-pkg-price')];
      if (p) el.textContent = A.money(p.price);
    });
  }
  var yr = document.getElementById('year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();

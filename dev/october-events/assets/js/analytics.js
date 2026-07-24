/* October Events — sales-analytics year-over-year chart.
   Interactive cumulative overlay: toggle years on/off (the y-axis rescales to the
   visible lines so a small live year isn't dwarfed), switch Tickets ⇄ Revenue, and
   hover a line to see which year + its value. Self-contained (no chart library). */
(function () {
  'use strict';
  var data = window.octYoY;
  var host = document.getElementById('oe-yoy-chart');
  var legendEl = document.getElementById('oe-yoy-legend');
  var tip = document.getElementById('oe-yoy-tip');
  if (!data || !host) { return; }

  var metric = 'tickets';
  var hidden = {}; // label -> true when toggled off
  var W = 1000, H = 320, padL = 58, padR = 14, padT = 12, padB = 30;
  var plotW = W - padL - padR, plotH = H - padT - padB;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function shortNum(v) { v = Math.round(v); if (Math.abs(v) >= 1000) { return (Math.round(v / 100) / 10) + 'k'; } return String(v); }
  function fmtAxis(v) { return metric === 'revenue' ? (data.curSym + shortNum(v)) : shortNum(v); }
  function fmtVal(v) { return metric === 'revenue' ? (data.curSym + (Math.round(v * 100) / 100).toLocaleString()) : Math.round(v).toLocaleString(); }
  function seriesFor() { return (data[metric] && data[metric].series) || []; }
  function visible() { return seriesFor().filter(function (s) { return !hidden[s.label]; }); }

  function render() {
    var ss = visible();
    var maxW = 1, maxY = 1;
    ss.forEach(function (s) { s.points.forEach(function (p) { if (p[0] > maxW) { maxW = p[0]; } if (p[1] > maxY) { maxY = p[1]; } }); });
    var X = function (wb) { return padL + ((maxW - wb) / maxW) * plotW; };
    var Y = function (v) { return padT + plotH - (v / maxY) * plotH; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;max-height:340px" preserveAspectRatio="xMidYMid meet">';
    for (var g = 0; g <= 4; g++) {
      var gv = maxY * g / 4, gy = Y(gv);
      svg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#eee"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="11" fill="#999">' + esc(fmtAxis(gv)) + '</text>';
    }
    var stride = Math.max(1, Math.ceil(maxW / 12));
    for (var wb = maxW; wb >= 0; wb -= stride) {
      var a = wb === maxW ? 'start' : (wb === 0 ? 'end' : 'middle');
      svg += '<text x="' + X(wb).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + a + '" font-size="11" fill="#777">' + (wb === 0 ? 'Event wk' : ('−' + wb)) + '</text>';
    }
    ss.forEach(function (s, i) {
      var pts = s.points.slice().sort(function (a, b) { return b[0] - a[0]; });
      var d = pts.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
      if (s.live) {
        svg += '<polygon points="' + X(maxW).toFixed(1) + ',' + (padT + plotH).toFixed(1) + ' ' + d + ' ' + X(0).toFixed(1) + ',' + (padT + plotH).toFixed(1) + '" fill="#E7CD41" fill-opacity="0.14"/>';
      }
      svg += '<polyline class="oe-yoy-line" data-i="' + i + '" points="' + d + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="' + (s.live ? 3.2 : 1.8) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.live ? '' : ' opacity="0.85"') + '><title>' + esc(s.label) + '</title></polyline>';
    });
    svg += '</svg>';
    host.innerHTML = svg;
    bindHover(ss, X, Y, maxW);
  }

  function bindHover(ss, X, Y, maxW) {
    host.querySelectorAll('.oe-yoy-line').forEach(function (pl) {
      var s = ss[+pl.getAttribute('data-i')];
      pl.style.cursor = 'pointer';
      pl.addEventListener('mouseenter', function () {
        pl.setAttribute('stroke-width', (parseFloat(pl.getAttribute('stroke-width')) + 1.8).toFixed(1));
        pl.setAttribute('opacity', '1');
      });
      pl.addEventListener('mousemove', function (e) {
        if (!tip) { return; }
        // value at the nearest week-before for this series
        var rect = host.getBoundingClientRect();
        var relX = (e.clientX - rect.left) / rect.width * W; // back to viewBox units
        var wb = Math.max(0, Math.min(maxW, Math.round(maxW - (relX - padL) / plotW * maxW)));
        var best = null;
        s.points.forEach(function (p) { if (best === null || Math.abs(p[0] - wb) < Math.abs(best[0] - wb)) { best = p; } });
        tip.innerHTML = '<strong>' + esc(s.label) + '</strong><br>' + (best ? (fmtVal(best[1]) + ' &middot; ' + (best[0] === 0 ? 'event wk' : ('−' + best[0] + ' wk'))) : '');
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      });
      pl.addEventListener('mouseleave', function () {
        pl.setAttribute('stroke-width', (s.live ? 3.2 : 1.8));
        pl.setAttribute('opacity', s.live ? '1' : '0.85');
        if (tip) { tip.style.display = 'none'; }
      });
    });
  }

  function buildLegend() {
    if (!legendEl) { return; }
    legendEl.innerHTML = '';
    seriesFor().forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'oe-yoy-leg' + (hidden[s.label] ? ' is-off' : '');
      b.innerHTML = '<span class="sw" style="background:' + esc(s.color) + '"></span>' + esc(s.label);
      b.addEventListener('click', function () {
        hidden[s.label] = !hidden[s.label];
        b.classList.toggle('is-off');
        render();
      });
      legendEl.appendChild(b);
    });
  }

  document.querySelectorAll('.oe-metric-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      metric = b.getAttribute('data-metric');
      document.querySelectorAll('.oe-metric-btn').forEach(function (x) {
        var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });

  buildLegend();
  render();
})();

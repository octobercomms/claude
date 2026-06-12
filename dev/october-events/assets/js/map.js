/**
 * October Events — Destinations map fallback (§7).
 *
 * Public display is normally handled by Elementor/JetEngine; this renders the
 * [oe_design_map] shortcode for surfaces that need a standalone map. It pulls
 * pins from /oe/v1/map and embeds Google Maps via the configured key.
 */
(function () {
    'use strict';

    var cfg = window.OE_MAP || {};
    var container = document.getElementById('oe-design-map');
    if (!container) { return; }

    var state = { categories: [] };

    function build() {
        container.innerHTML =
            '<aside class="oe-map-filters"></aside>' +
            '<div class="oe-map-canvas" id="oe-map-canvas"></div>' +
            '<div class="oe-map-detail" id="oe-map-detail" hidden></div>';

        var filters = container.querySelector('.oe-map-filters');
        (cfg.categories || []).forEach(function (c) {
            var id = 'oe-cat-' + c;
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" id="' + id + '" value="' + c + '"> ' + c.replace(/_/g, ' ');
            label.querySelector('input').addEventListener('change', onFilterChange);
            filters.appendChild(label);
        });
        fetchPins();
    }

    function onFilterChange() {
        state.categories = Array.prototype.map.call(
            container.querySelectorAll('.oe-map-filters input:checked'),
            function (i) { return i.value; }
        );
        fetchPins();
    }

    function fetchPins() {
        var url = cfg.restUrl + (state.categories.length ? '?categories=' + state.categories.join(',') : '');
        fetch(url).then(function (r) { return r.json(); }).then(render);
    }

    function render(pins) {
        var canvas = document.getElementById('oe-map-canvas');
        if (!cfg.embedKey) {
            canvas.innerHTML = '<p>Map key not configured.</p>';
            return;
        }
        // Center on the first pin (or Atlanta) and drop an embed. Marker-level
        // interactivity uses the JS API when a richer build is wired; the embed
        // keeps the fallback dependency-free.
        var center = pins.length ? pins[0].lat + ',' + pins[0].lng : '33.749,-84.388';
        canvas.innerHTML = '<iframe width="100%" height="480" style="border:0" loading="lazy" ' +
            'src="https://www.google.com/maps/embed/v1/view?key=' + encodeURIComponent(cfg.embedKey) +
            '&center=' + encodeURIComponent(center) + '&zoom=12"></iframe>';

        var list = pins.map(function (p) {
            return '<li class="' + (p.featured ? 'is-featured' : '') + '"><strong>' + escapeHtml(p.name) + '</strong> — ' +
                escapeHtml(p.category.replace(/_/g, ' ')) + (p.website ? ' · <a href="' + escapeHtml(p.website) + '" target="_blank" rel="noopener">site</a>' : '') + '</li>';
        }).join('');
        var detail = document.getElementById('oe-map-detail');
        detail.hidden = false;
        detail.innerHTML = '<ul class="oe-map-list">' + (list || '<li>No destinations match.</li>') + '</ul>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    build();
})();

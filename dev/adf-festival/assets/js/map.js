/**
 * ADF Festival — Destinations map fallback (§7).
 *
 * Public display is normally handled by Elementor/JetEngine; this renders the
 * [adf_design_map] shortcode for surfaces that need a standalone map. It pulls
 * pins from /adf/v1/map and embeds Google Maps via the configured key.
 */
(function () {
    'use strict';

    var cfg = window.ADF_MAP || {};
    var container = document.getElementById('adf-design-map');
    if (!container) { return; }

    var state = { categories: [] };

    function build() {
        container.innerHTML =
            '<aside class="adf-map-filters"></aside>' +
            '<div class="adf-map-canvas" id="adf-map-canvas"></div>' +
            '<div class="adf-map-detail" id="adf-map-detail" hidden></div>';

        var filters = container.querySelector('.adf-map-filters');
        (cfg.categories || []).forEach(function (c) {
            var id = 'adf-cat-' + c;
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" id="' + id + '" value="' + c + '"> ' + c.replace(/_/g, ' ');
            label.querySelector('input').addEventListener('change', onFilterChange);
            filters.appendChild(label);
        });
        fetchPins();
    }

    function onFilterChange() {
        state.categories = Array.prototype.map.call(
            container.querySelectorAll('.adf-map-filters input:checked'),
            function (i) { return i.value; }
        );
        fetchPins();
    }

    function fetchPins() {
        var url = cfg.restUrl + (state.categories.length ? '?categories=' + state.categories.join(',') : '');
        fetch(url).then(function (r) { return r.json(); }).then(render);
    }

    function render(pins) {
        var canvas = document.getElementById('adf-map-canvas');
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
        var detail = document.getElementById('adf-map-detail');
        detail.hidden = false;
        detail.innerHTML = '<ul class="adf-map-list">' + (list || '<li>No destinations match.</li>') + '</ul>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    build();
})();

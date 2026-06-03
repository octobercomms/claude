/**
 * ADF Festival — ad slot hydration. Fills [adf_ad] slots from the REST render
 * endpoint (so slots survive page caching) and appends the source page URL for
 * tracking.
 */
(function () {
    'use strict';
    var slots = document.querySelectorAll('.adf-ad-slot[data-render]');
    if (!slots.length) { return; }
    var page = encodeURIComponent(location.href);

    slots.forEach(function (slot) {
        var url = slot.getAttribute('data-render') +
            '?format=' + encodeURIComponent(slot.getAttribute('data-format')) +
            '&source=' + page + '&_=' + Date.now();
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.html) {
                slot.innerHTML = data.html;
                // Append source page to the click link for attribution.
                var a = slot.querySelector('a[href]');
                if (a) { a.href += '&page=' + page; }
            }
        }).catch(function () {});
    });
})();

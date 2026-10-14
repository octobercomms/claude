/**
 * Shared person-record opener. Any element carrying data-oe-person (with
 * data-email or data-person-id) opens the unified person record in the shared
 * slide-in: fetch the body over AJAX, inject it, then open the panel. Lets the
 * Volunteers, Team and Accounts screens show the same record without a page
 * load. Depends on admin-slidein.js (window.oeSlide) and oePersonRecord
 * (ajaxurl + nonce) localized by PeopleScreen::mount_record_slidein().
 */
(function () {
    'use strict';

    function body() {
        var panel = document.getElementById('oe-person-record');
        return panel ? panel.querySelector('.oe-slide-body') : null;
    }

    function load(email, id) {
        var slot = body();
        if (!slot || !window.oePersonRecord || !window.oeSlide) { return; }
        slot.innerHTML = '<p class="description" style="padding:8px">' + (window.oePersonRecord.loading || 'Loading…') + '</p>';
        window.oeSlide.open(document.getElementById('oe-person-record'));

        var data = new FormData();
        data.append('action', 'oe_people_detail');
        data.append('nonce', window.oePersonRecord.nonce);
        if (id) { data.append('id', id); }
        if (email) { data.append('email', email); }

        fetch(window.oePersonRecord.ajaxurl, { method: 'POST', credentials: 'same-origin', body: data })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.success && res.data && res.data.html) {
                    slot.innerHTML = res.data.html;
                } else {
                    slot.innerHTML = '<p class="description" style="padding:8px;color:#b23c17">' + (window.oePersonRecord.error || 'Could not load this record.') + '</p>';
                }
            })
            .catch(function () {
                slot.innerHTML = '<p class="description" style="padding:8px;color:#b23c17">' + (window.oePersonRecord.error || 'Could not load this record.') + '</p>';
            });
    }

    document.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-oe-person]') : null;
        if (!t) { return; }
        e.preventDefault();
        load(t.getAttribute('data-email') || '', t.getAttribute('data-person-id') || '');
    });
})();

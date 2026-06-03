/* October Outreach — Admin JS */

(function ($) {
    'use strict';

    $(document).ready(function () {

        // Auto-dismiss success notices after 4s
        setTimeout(function () {
            $('.notice-success.is-dismissible').fadeOut(400);
        }, 4000);

        // Confirm deletes (fallback for non-form links)
        $(document).on('click', '.oo-confirm-delete', function (e) {
            if (!confirm('Are you sure? This cannot be undone.')) {
                e.preventDefault();
            }
        });

    });

}(jQuery));

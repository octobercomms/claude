/* Hosts & info pack metabox: contact repeater, role toggle, PDF picker. */
(function ($) {
    'use strict';

    var $rows = $('#oe-hosts-rows');

    // Add a blank contact row from the template, renumbered.
    $('#oe-hosts-add').on('click', function () {
        var tpl = document.getElementById('oe-hosts-tpl');
        if (!tpl) { return; }
        var html = tpl.innerHTML.replace(/9999/g, Date.now().toString());
        $rows.append(html);
    });

    // Remove a row (keep at least one so the table never vanishes).
    $rows.on('click', '.oe-hosts-del', function () {
        if ($rows.find('.oe-hosts-row').length > 1) {
            $(this).closest('.oe-hosts-row').remove();
        } else {
            $(this).closest('.oe-hosts-row').find('input').val('');
        }
    });

    // Show the free-text role box only when "Other" is chosen.
    $rows.on('change', '.oe-host-role', function () {
        var $other = $(this).closest('td').find('.oe-host-role-other');
        $other.toggle($(this).val() === 'other');
    });

    // PDF media picker.
    var frame;
    $('#oe-host-pdf-pick').on('click', function (e) {
        e.preventDefault();
        frame = wp.media({
            title: (window.OE_HOSTS && OE_HOSTS.choosePdf) || 'Choose a PDF',
            library: { type: 'application/pdf' },
            multiple: false,
            button: { text: (window.OE_HOSTS && OE_HOSTS.usePdf) || 'Use this PDF' }
        });
        frame.on('select', function () {
            var a = frame.state().get('selection').first().toJSON();
            $('#oe-host-pdf').val(a.id);
            $('#oe-host-pdf-name').text(a.filename || a.title || a.url);
        });
        frame.open();
    });

    $('#oe-host-pdf-clear').on('click', function (e) {
        e.preventDefault();
        $('#oe-host-pdf').val('');
        $('#oe-host-pdf-name').text('none');
    });
}(jQuery));

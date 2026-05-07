/* October Event Tickets — Admin Meta Box JS */
(function ($) {
  'use strict';

  var ticketIndex = $('.oct-ticket-type-row').length;
  var venueIndex  = $('.oct-venue-row').length;

  /* ---- Add Ticket Type ---- */
  $('.oct-add-ticket-type').on('click', function () {
    var tpl = $('#oct-ticket-type-template').html();
    tpl = tpl.replace(/\{\{INDEX\}\}/g, ticketIndex++);
    var $row = $(tpl);
    $('#oct-ticket-types').append($row);
    $row.find('.oct-tt-label').focus();
    bindAutoSlug($row);
  });

  /* ---- Add Venue ---- */
  $('.oct-add-venue').on('click', function () {
    var tpl = $('#oct-venue-template').html();
    tpl = tpl.replace(/\{\{INDEX\}\}/g, venueIndex++);
    $('#oct-venues').append($(tpl));
  });

  /* ---- Remove row ---- */
  $(document).on('click', '.oct-remove-row', function () {
    $(this).closest('.oct-repeater-row').slideUp(200, function () {
      $(this).remove();
    });
  });

  /* ---- Auto-slug from label ---- */
  function bindAutoSlug($row) {
    $row.find('.oct-tt-label').on('input', function () {
      var $keyField = $row.find('.oct-tt-key');
      if ($keyField.data('manual')) return;
      var slug = $(this).val()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      $keyField.val(slug);
    });

    $row.find('.oct-tt-key').on('input', function () {
      $(this).data('manual', true);
    });
  }

  // Bind auto-slug on existing rows
  $('.oct-ticket-type-row').each(function () {
    bindAutoSlug($(this));
  });

})(jQuery);

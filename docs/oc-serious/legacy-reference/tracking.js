document.addEventListener('click', function(e) {
    var btn = e.target.closest('.nvelope-asset-open, .nvelope-action-pdf, .nvelope-action-video');
    if (!btn) return;

    var card = btn.closest('.jet-listing-grid__item');
    if (!card) return;

    var uid   = card.querySelector('.nvelope-asset-uid .jet-listing-dynamic-field__content');
    var title = card.querySelector('.nvelope-asset-title .jet-listing-dynamic-field__content');
    var type  = card.querySelector('.nvelope-asset-type .jet-listing-dynamic-field__content');

    if (typeof gtag !== 'function') return;

    gtag('event', 'asset_click', {
        'asset_uid':   uid   ? uid.textContent.trim()   : 'unknown',
        'asset_title': title ? title.textContent.trim() : 'unknown',
        'asset_type':  type  ? type.textContent.trim()  : 'unknown'
    });
});
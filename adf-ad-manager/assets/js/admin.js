/* jshint eqeqeq: true, unused: true */
(function ( $ ) {
	'use strict';

	// ── Media uploader ────────────────────────────────────────────────────────
	var mediaFrame;

	$( document ).on( 'click', '.adf-media-upload', function ( e ) {
		e.preventDefault();
		var $btn    = $( this );
		var format  = $btn.data( 'format' );
		var $input  = $( '#adf-image-url-' + format );
		var $preview = $( '#adf-preview-' + format );

		if ( mediaFrame ) {
			mediaFrame.off( 'select' );
		}

		mediaFrame = wp.media({
			title:    'Select Ad Image',
			button:   { text: 'Use This Image' },
			multiple: false,
			library:  { type: 'image' },
		});

		mediaFrame.on( 'select', function () {
			var attachment = mediaFrame.state().get( 'selection' ).first().toJSON();
			$input.val( attachment.url );
			$preview.html( '<img src="' + attachment.url + '" alt="" style="max-width:200px;max-height:100px;">' ).show();
			$btn.text( 'Change Image' );
		});

		mediaFrame.open();
	});

	// ── Restriction toggles ───────────────────────────────────────────────────
	function bindRestrictionToggle( checkboxId, wrapId ) {
		$( '#' + checkboxId ).on( 'change', function () {
			var $wrap = $( '#' + wrapId );
			if ( $( this ).is( ':checked' ) ) {
				$wrap.slideDown( 150 );
			} else {
				$wrap.slideUp( 150 );
			}
		});
	}

	bindRestrictionToggle( 'adf_restrict_imp', 'adf-imp-cap-wrap' );
	bindRestrictionToggle( 'adf_restrict_clk', 'adf-clk-cap-wrap' );

	// ── Partner sites: add / remove rows ─────────────────────────────────────
	$( document ).on( 'click', '.adf-add-partner', function ( e ) {
		e.preventDefault();
		var $list = $( '.adf-partner-sites-list' );
		var idx   = $list.find( 'li' ).length;
		$list.append(
			'<li>' +
			'<input type="url" name="adf_partner_sites[' + idx + ']" class="regular-text" placeholder="https://partner-site.com">' +
			'<button type="button" class="button adf-remove-partner">Remove</button>' +
			'</li>'
		);
	});

	$( document ).on( 'click', '.adf-remove-partner', function () {
		$( this ).closest( 'li' ).remove();
	});

	// ── Mode selector toggle ──────────────────────────────────────────────────
	function updateModeUI() {
		var mode = $( 'input[name="adf_site_mode"]:checked' ).val();
		if ( mode === 'hub' ) {
			$( '.adf-hub-settings' ).show();
			$( '.adf-partner-settings' ).hide();
		} else {
			$( '.adf-hub-settings' ).hide();
			$( '.adf-partner-settings' ).show();
		}
	}

	$( 'input[name="adf_site_mode"]' ).on( 'change', updateModeUI );
	updateModeUI();

	// ── Copy API key ──────────────────────────────────────────────────────────
	$( document ).on( 'click', '.adf-copy-key', function () {
		var key = $( '.adf-api-key-display' ).text().trim();
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( key ).then( function () {
				$( '.adf-copy-key' ).text( 'Copied!' );
				setTimeout( function () {
					$( '.adf-copy-key' ).text( 'Copy' );
				}, 2000 );
			});
		}
	});

}( jQuery ) );

/* jshint eqeqeq: true, unused: true */
(function ( $ ) {
	'use strict';

	// ── Media uploader ────────────────────────────────────────────────────────
	var mediaFrame;

	$( document ).on( 'click', '.ocad-media-upload', function ( e ) {
		e.preventDefault();
		var $btn    = $( this );
		var format  = $btn.data( 'format' );
		var $input  = $( '#ocad-image-url-' + format );
		var $preview = $( '#ocad-preview-' + format );

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

	bindRestrictionToggle( 'ocad_restrict_imp', 'ocad-imp-cap-wrap' );
	bindRestrictionToggle( 'ocad_restrict_clk', 'ocad-clk-cap-wrap' );

	// ── Mode selector toggle ──────────────────────────────────────────────────
	function updateModeUI() {
		var mode = $( 'input[name="ocad_site_mode"]:checked' ).val();
		if ( mode === 'hub' ) {
			$( '.ocad-hub-settings' ).show();
			$( '.ocad-partner-settings' ).hide();
		} else {
			$( '.ocad-hub-settings' ).hide();
			$( '.ocad-partner-settings' ).show();
		}
	}

	$( 'input[name="ocad_site_mode"]' ).on( 'change', updateModeUI );
	updateModeUI();

	// ── Copy shortcode ────────────────────────────────────────────────────────
	$( document ).on( 'click', '.ocad-copy-shortcode', function () {
		var sc  = $( this ).data( 'shortcode' );
		var $msg = $( this ).siblings( '.ocad-copied-msg' );
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( sc ).then( function () {
				$msg.show();
				setTimeout( function () { $msg.hide(); }, 2000 );
			});
		}
	});

	// ── Copy API key ──────────────────────────────────────────────────────────
	$( document ).on( 'click', '.ocad-copy-key', function () {
		var key = $( '.ocad-api-key-display' ).text().trim();
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( key ).then( function () {
				$( '.ocad-copy-key' ).text( 'Copied!' );
				setTimeout( function () {
					$( '.ocad-copy-key' ).text( 'Copy' );
				}, 2000 );
			});
		}
	});

}( jQuery ) );

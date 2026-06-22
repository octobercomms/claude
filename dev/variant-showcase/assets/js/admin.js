/**
 * Media-library picker for the lifestyle image fields, both on the product
 * General tab and on each variation (which load via AJAX, hence delegated
 * event handlers).
 */
( function ( $ ) {
	'use strict';

	/*
	 * Show the Variant Showcase fields only when they apply, so the General tab
	 * stays clean:
	 *   - "Featured variation" only matters for the "Feature one variation" mode.
	 *   - The product-level "Lifestyle image" only applies to single-card products
	 *     (default / feature-one). In "expand" mode each variation carries its own.
	 */
	function acvsToggleFields() {
		var $mode = $( '#_acvs_mode' );
		if ( ! $mode.length ) {
			return;
		}
		var mode = $mode.val();
		$( '._acvs_single_variation_field' ).toggle( mode === 'single' );
		$( '.acvs-product-lifestyle-field' ).toggle( mode !== 'expand' );
	}

	$( document ).on( 'change', '#_acvs_mode', acvsToggleFields );
	acvsToggleFields();

	$( document ).on( 'click', '.acvs-upload-image', function ( e ) {
		e.preventDefault();

		var $field   = $( this ).closest( '.acvs-image-field' );
		var $input   = $field.find( '.acvs-image-id' );
		var $preview = $field.find( '.acvs-image-preview' );
		var $remove  = $field.find( '.acvs-remove-image' );

		var frame = wp.media( {
			title: ( window.acvs && acvs.title ) || 'Select image',
			button: { text: ( window.acvs && acvs.button ) || 'Use this image' },
			library: { type: 'image' },
			multiple: false,
		} );

		frame.on( 'select', function () {
			var attachment = frame.state().get( 'selection' ).first().toJSON();
			var url = ( attachment.sizes && attachment.sizes.thumbnail )
				? attachment.sizes.thumbnail.url
				: attachment.url;

			$input.val( attachment.id );
			$preview.html( '<img src="' + url + '" alt="" />' );
			$remove.show();
		} );

		frame.open();
	} );

	$( document ).on( 'click', '.acvs-remove-image', function ( e ) {
		e.preventDefault();
		var $field = $( this ).closest( '.acvs-image-field' );
		$field.find( '.acvs-image-id' ).val( '' );
		$field.find( '.acvs-image-preview' ).empty();
		$( this ).hide();
	} );
}( jQuery ) );

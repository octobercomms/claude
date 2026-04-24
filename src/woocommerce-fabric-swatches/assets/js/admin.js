/* global jQuery, wp, wcFabricSwatchesAdmin */
jQuery( function ( $ ) {
	'use strict';

	// -------------------------------------------------------------------------
	// Re-index all group + swatch name attributes after any DOM change
	// -------------------------------------------------------------------------
	function reIndex() {
		$( '.wc-fabric-swatches-group' ).each( function ( gi ) {
			var $group = $( this );
			$group.attr( 'data-group-index', gi );

			// Re-index every named input/textarea inside this group
			$group.find( '[name]' ).each( function () {
				var name = $( this ).attr( 'name' );
				name = name.replace( /fabric_swatch_groups\[\d+\]/, 'fabric_swatch_groups[' + gi + ']' );
				$( this ).attr( 'name', name );
			} );

			// Re-index each swatch within the group
			$group.find( '.wc-fabric-swatch-item' ).each( function ( si ) {
				$( this ).attr( 'data-swatch-index', si );
				$( this ).find( '[name]' ).each( function () {
					var name = $( this ).attr( 'name' );
					name = name.replace( /\[swatches\]\[\d+\]/, '[swatches][' + si + ']' );
					$( this ).attr( 'name', name );
				} );
			} );
		} );
	}

	// -------------------------------------------------------------------------
	// Add group
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatches-add-group', function () {
		var gi = $( '.wc-fabric-swatches-group' ).length;
		var tpl = wp.template( 'swatch-group' );
		$( '#wc-fabric-swatches-groups' ).append( tpl( { groupIndex: gi } ) );
	} );

	// -------------------------------------------------------------------------
	// Remove group
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatches-remove-group', function () {
		if ( ! window.confirm( wcFabricSwatchesAdmin.confirmRemove ) ) {
			return;
		}
		$( this ).closest( '.wc-fabric-swatches-group' ).remove();
		reIndex();
	} );

	// -------------------------------------------------------------------------
	// Toggle group body visibility
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatches-toggle-group, .wc-fabric-swatches-group-header', function ( e ) {
		// Don't toggle when clicking action buttons
		if ( $( e.target ).is( 'button' ) || $( e.target ).closest( '.wc-fabric-swatches-group-actions' ).length ) {
			return;
		}
		$( this ).closest( '.wc-fabric-swatches-group' ).find( '.wc-fabric-swatches-group-body' ).slideToggle( 200 );
	} );

	// Keep header title display in sync with input
	$( document ).on( 'input', '.wc-fabric-swatches-group-title-input', function () {
		var val = $( this ).val().trim() || 'New Group';
		$( this ).closest( '.wc-fabric-swatches-group' )
			.find( '.wc-fabric-swatches-group-title-display' )
			.text( val );
	} );

	// -------------------------------------------------------------------------
	// Add swatch to a group
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatches-add-swatch', function () {
		var $group = $( this ).closest( '.wc-fabric-swatches-group' );
		var gi     = $group.attr( 'data-group-index' );
		var si     = $group.find( '.wc-fabric-swatch-item' ).length;
		var tpl    = wp.template( 'swatch-item' );
		$group.find( '.wc-fabric-swatches-swatches-list' ).append( tpl( { groupIndex: gi, swatchIndex: si } ) );
	} );

	// -------------------------------------------------------------------------
	// Remove swatch
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatch-remove', function () {
		$( this ).closest( '.wc-fabric-swatch-item' ).remove();
		reIndex();
	} );

	// -------------------------------------------------------------------------
	// Media library image picker
	// Each click opens a fresh wp.media frame so the 'select' callback always
	// has the correct button reference captured in the closure.
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatch-upload-image', function () {
		var $btn  = $( this );
		var type  = $btn.data( 'type' ); // 'fabric' or 'product'
		var $field = $btn.closest( '.wc-fabric-swatch-image-field' );

		var frame = wp.media( {
			title:    wcFabricSwatchesAdmin.chooseImage,
			button:   { text: wcFabricSwatchesAdmin.chooseImageBtn },
			multiple: false,
			library:  { type: 'image' },
		} );

		frame.on( 'select', function () {
			var attachment = frame.state().get( 'selection' ).first().toJSON();
			var imgUrl = attachment.sizes && attachment.sizes.thumbnail
				? attachment.sizes.thumbnail.url
				: attachment.url;

			$field.find( '.wc-fabric-swatch-image-wrap img' ).remove();
			$field.find( '.wc-fabric-swatch-image-wrap' ).prepend( '<img src="' + imgUrl + '" alt="">' );
			$field.find( '.wc-fabric-swatch-remove-image' ).removeClass( 'hidden' );

			if ( type === 'fabric' ) {
				$field.find( '.wc-fabric-swatch-image-id' ).val( attachment.id );
			} else {
				$field.find( '.wc-fabric-swatch-product-image-id' ).val( attachment.id );
			}
		} );

		frame.open();
	} );

	// -------------------------------------------------------------------------
	// Remove image
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatch-remove-image', function () {
		var $field = $( this ).closest( '.wc-fabric-swatch-image-field' );
		$field.find( '.wc-fabric-swatch-image-wrap img' ).remove();
		$field.find( '.wc-fabric-swatch-image-id, .wc-fabric-swatch-product-image-id' ).val( '' );
		$( this ).addClass( 'hidden' );
	} );
} );

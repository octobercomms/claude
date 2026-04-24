/* global jQuery, wcFabricSwatches */
( function ( $ ) {
	'use strict';

	var $drawer, $overlay, $body;
	var _prevFocus       = null;
	var _focusTrapEl     = null;
	var _focusTrapBound  = null;

	// -------------------------------------------------------------------------
	// Bootstrap
	// -------------------------------------------------------------------------
	function init() {
		$drawer  = $( '.wc-fabric-swatches-drawer' );
		$overlay = $( '.wc-fabric-swatches-overlay' );
		$body    = $( 'body' );

		if ( ! $drawer.length ) {
			return;
		}

		$( document ).on( 'click', '.wc-fabric-swatches-open-drawer', openDrawer );
		$( document ).on( 'click', '.wc-fabric-swatches-close',       closeDrawer );
		$( document ).on( 'click', '.wc-fabric-swatches-overlay',     closeDrawer );
		$( document ).on( 'keydown', onKeyDown );
		$( document ).on( 'click', '.wc-fabric-swatch-btn', onSwatchClick );
	}

	// -------------------------------------------------------------------------
	// Drawer open / close
	// -------------------------------------------------------------------------
	function openDrawer() {
		$drawer.addClass( 'is-open' ).attr( 'aria-hidden', 'false' );
		$overlay.addClass( 'is-visible' );
		$body.addClass( 'wc-fabric-swatches-open' );
		trapFocus( $drawer[ 0 ] );
		$drawer.find( '.wc-fabric-swatches-close' ).first().trigger( 'focus' );
	}

	function closeDrawer() {
		$drawer.removeClass( 'is-open' ).attr( 'aria-hidden', 'true' );
		$overlay.removeClass( 'is-visible' );
		$body.removeClass( 'wc-fabric-swatches-open' );
		releaseFocus();
	}

	function onKeyDown( e ) {
		if ( e.key === 'Escape' && $drawer.hasClass( 'is-open' ) ) {
			closeDrawer();
		}
	}

	// -------------------------------------------------------------------------
	// Swatch selection
	// -------------------------------------------------------------------------
	function onSwatchClick() {
		var $btn = $( this );
		var key  = $btn.data( 'swatch' );
		var data = ( wcFabricSwatches && wcFabricSwatches.swatches && wcFabricSwatches.swatches[ key ] ) || {};

		// Mark active in drawer
		$( '.wc-fabric-swatch-btn' ).removeClass( 'is-selected' ).attr( 'aria-pressed', 'false' );
		$btn.addClass( 'is-selected' ).attr( 'aria-pressed', 'true' );

		// Update trigger-area preview
		var name      = data.name || $btn.find( '.wc-fabric-swatch-name' ).text().trim();
		var fabricSrc = data.fabricImage || $btn.find( '.wc-fabric-swatch-tile img' ).attr( 'src' ) || '';

		$( '.wc-fabric-swatches-selected-name' ).text( name );

		if ( fabricSrc ) {
			var $preview = $( '.wc-fabric-swatches-selected-preview' );
			var $img     = $preview.find( 'img' );
			if ( $img.length ) {
				$img.attr( { src: fabricSrc, alt: name } );
			} else {
				$preview.html( '<img src="' + fabricSrc + '" alt="' + escAttr( name ) + '">' );
			}
		}

		// Swap the main WooCommerce product gallery image
		if ( data.productImage ) {
			updateGalleryImage( data.productImage, name );
		}

		closeDrawer();
	}

	// -------------------------------------------------------------------------
	// Gallery image update
	// WooCommerce renders the main image inside .woocommerce-product-gallery__image
	// We update the <img> src and reset the zoom/lightbox href when present.
	// -------------------------------------------------------------------------
	function updateGalleryImage( src, alt ) {
		var $galleryWrapper = $( '.woocommerce-product-gallery__image' ).first();
		var $img = $galleryWrapper.find( 'img' ).first();

		if ( ! $img.length ) {
			return;
		}

		// Update srcset / src (strip srcset so it won't override our choice)
		$img.removeAttr( 'srcset' ).attr( { src: src, alt: alt || '' } );

		// Update the lightbox anchor href if present
		$galleryWrapper.filter( 'a' ).add( $galleryWrapper.find( 'a' ).first() ).attr( 'href', src );

		// Tell WooCommerce / Photoswipe the image changed
		$( document.body ).trigger( 'wc-product-gallery-reset-slide-position' );
	}

	// -------------------------------------------------------------------------
	// Focus trap
	// -------------------------------------------------------------------------
	function trapFocus( el ) {
		_prevFocus  = document.activeElement;
		_focusTrapEl = el;

		var focusable = el.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		var first = focusable[ 0 ];
		var last  = focusable[ focusable.length - 1 ];

		_focusTrapBound = function ( e ) {
			if ( e.key !== 'Tab' ) {
				return;
			}
			if ( e.shiftKey ) {
				if ( document.activeElement === first ) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if ( document.activeElement === last ) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		el.addEventListener( 'keydown', _focusTrapBound );
	}

	function releaseFocus() {
		if ( _focusTrapEl && _focusTrapBound ) {
			_focusTrapEl.removeEventListener( 'keydown', _focusTrapBound );
		}
		_focusTrapEl    = null;
		_focusTrapBound = null;
		if ( _prevFocus ) {
			_prevFocus.focus();
			_prevFocus = null;
		}
	}

	// -------------------------------------------------------------------------
	// Utility
	// -------------------------------------------------------------------------
	function escAttr( str ) {
		return String( str )
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#x27;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}

	$( document ).ready( init );

} ( jQuery ) );

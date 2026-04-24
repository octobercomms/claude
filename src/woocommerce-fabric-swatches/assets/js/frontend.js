/* global jQuery, wcFabricSwatches */
( function ( $ ) {
	'use strict';

	var $drawer, $overlay, $body;
	var _prevFocus      = null;
	var _focusTrapEl    = null;
	var _focusTrapBound = null;

	// -------------------------------------------------------------------------
	// Init
	// -------------------------------------------------------------------------
	function init() {
		if ( typeof wcFabricSwatches === 'undefined' ) {
			return;
		}

		$drawer  = $( '.wc-fabric-swatches-drawer' );
		$overlay = $( '.wc-fabric-swatches-overlay' );
		$body    = $( 'body' );

		if ( ! $drawer.length ) {
			return;
		}

		// Hide the CartFlows / Variation Swatches row for our attribute so
		// only our drawer trigger is visible. The underlying <select> stays
		// in the DOM so WooCommerce variation JS keeps working.
		hideVariationRow();

		// Check if a fabric is already selected on page load (e.g. via URL param)
		syncInitialSelection();

		// Events
		$( document ).on( 'click', '.wc-fabric-swatches-open-drawer', openDrawer );
		$( document ).on( 'click', '.wc-fabric-swatches-close',       closeDrawer );
		$( document ).on( 'click', '.wc-fabric-swatches-overlay',     closeDrawer );
		$( document ).on( 'keydown', function ( e ) {
			if ( e.key === 'Escape' && $drawer.hasClass( 'is-open' ) ) {
				closeDrawer();
			}
		} );
		$( document ).on( 'click', '.wc-fabric-swatch-btn', onSwatchClick );

		// Keep in sync when WooCommerce resets the variation form
		$( document.body ).on( 'woocommerce_variation_select_updated reset_data', syncInitialSelection );
	}

	// -------------------------------------------------------------------------
	// Hide the existing CartFlows swatch row for this attribute
	// -------------------------------------------------------------------------
	function hideVariationRow() {
		var inputName = wcFabricSwatches.attributeInput; // e.g. 'attribute_pa_colour'

		// The variations table row that contains the select for our attribute
		var $select = $( 'select[name="' + inputName + '"]' );
		if ( $select.length ) {
			$select.closest( 'tr' ).addClass( 'wc-fabric-swatches-hidden-row' );
		}

		// Also hide any CartFlows wrapper directly (belt-and-braces)
		$( '.cfvsw-swatches-container[data-attribute_name="' + inputName + '"],' +
		   '.swatches-select[data-attribute_name="' + inputName + '"]' )
			.closest( 'tr' ).addClass( 'wc-fabric-swatches-hidden-row' );
	}

	// -------------------------------------------------------------------------
	// Sync trigger area with whatever is currently selected in the WC form
	// -------------------------------------------------------------------------
	function syncInitialSelection() {
		var val = $( 'select[name="' + wcFabricSwatches.attributeInput + '"]' ).val();
		if ( ! val ) {
			return;
		}
		var $btn = $( '.wc-fabric-swatch-btn[data-term="' + val + '"]' );
		if ( $btn.length ) {
			markSelected( $btn );
			updateTrigger( $btn );
		}
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

	// -------------------------------------------------------------------------
	// Swatch click — drives WooCommerce variation selection
	// -------------------------------------------------------------------------
	function onSwatchClick() {
		var $btn     = $( this );
		var termSlug = $btn.data( 'term' );

		// 1. Set the WooCommerce variation <select> and trigger its change event.
		//    WooCommerce's wc-add-to-cart-variation.js listens for this and will
		//    match the variation, update the price, gallery image, and Add to Cart.
		var $select = $( 'select[name="' + wcFabricSwatches.attributeInput + '"]' );
		if ( $select.length ) {
			$select.val( termSlug ).trigger( 'change' );
		}

		// 2. Also click the hidden CartFlows swatch element so its internal
		//    selected-state CSS stays consistent (doesn't affect the order,
		//    just their styling).
		var $cfvswSwatch = $(
			'[data-attribute_name="' + wcFabricSwatches.attributeInput + '"] [data-slug="' + termSlug + '"],' +
			'[data-attribute_name="' + wcFabricSwatches.attributeInput + '"] [data-value="' + termSlug + '"]'
		);
		if ( $cfvswSwatch.length ) {
			$cfvswSwatch.first().trigger( 'click' );
		}

		// 3. Update our own UI
		markSelected( $btn );
		updateTrigger( $btn );

		closeDrawer();
	}

	// -------------------------------------------------------------------------
	// UI helpers
	// -------------------------------------------------------------------------

	function markSelected( $btn ) {
		$( '.wc-fabric-swatch-btn' ).removeClass( 'is-selected' ).attr( 'aria-pressed', 'false' );
		$btn.addClass( 'is-selected' ).attr( 'aria-pressed', 'true' );
	}

	function updateTrigger( $btn ) {
		var name    = $btn.find( '.wc-fabric-swatch-name' ).text().trim();
		var $tile   = $btn.find( '.wc-fabric-swatch-tile' );
		var $img    = $tile.find( 'img' );
		var $color  = $tile.find( '.wc-fabric-swatch-color' );

		$( '.wc-fabric-swatches-selected-name' ).text( name );

		var $preview = $( '.wc-fabric-swatches-selected-preview' );
		$preview.empty();

		if ( $img.length ) {
			$preview.html( '<img src="' + $img.attr( 'src' ) + '" alt="' + escAttr( name ) + '">' );
		} else if ( $color.length ) {
			$preview.html( '<span style="display:block;width:100%;height:100%;background:' + $color.css( 'background-color' ) + ';border-radius:50%"></span>' );
		}
	}

	// -------------------------------------------------------------------------
	// Focus trap
	// -------------------------------------------------------------------------
	function trapFocus( el ) {
		_prevFocus   = document.activeElement;
		_focusTrapEl = el;

		var focusable = el.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		var first = focusable[ 0 ];
		var last  = focusable[ focusable.length - 1 ];

		_focusTrapBound = function ( e ) {
			if ( e.key !== 'Tab' ) return;
			if ( e.shiftKey ) {
				if ( document.activeElement === first ) { e.preventDefault(); last.focus(); }
			} else {
				if ( document.activeElement === last )  { e.preventDefault(); first.focus(); }
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
		if ( _prevFocus ) { _prevFocus.focus(); _prevFocus = null; }
	}

	function escAttr( str ) {
		return String( str )
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}

	$( document ).ready( init );

}( jQuery ) );

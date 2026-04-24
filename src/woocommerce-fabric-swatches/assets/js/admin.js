/* global jQuery, wcFabricSwatchesAdmin */
jQuery( function ( $ ) {
	'use strict';

	// Guard: only run on product edit screens where our data object was injected
	if ( typeof wcFabricSwatchesAdmin === 'undefined' ) {
		return;
	}

	var $groupsWrap = $( '#wc-fabric-swatches-groups' );
	var $addBtn     = $( '#wc-fabric-swatches-add-group' );
	var $attrSelect = $( '#fabric-swatch-attribute' );

	// -------------------------------------------------------------------------
	// Attribute change
	// -------------------------------------------------------------------------
	$attrSelect.on( 'change', function () {
		var newAttr = $( this ).val();

		if ( $groupsWrap.find( '.wc-fabric-swatches-group' ).length ) {
			if ( ! window.confirm( wcFabricSwatchesAdmin.confirmChangeAttr ) ) {
				$( this ).val( wcFabricSwatchesAdmin.selectedAttribute );
				return;
			}
		}

		wcFabricSwatchesAdmin.selectedAttribute = newAttr;

		// Refresh the term checkboxes in every existing group (clear selections)
		$groupsWrap.find( '.wc-fabric-swatches-group' ).each( function () {
			var gi = $( this ).attr( 'data-group-index' );
			$( this ).find( '.wc-fabric-swatches-terms-list' )
				.html( buildTermCheckboxes( gi, newAttr, [] ) );
		} );

		$addBtn.toggle( !! newAttr );
	} );

	// -------------------------------------------------------------------------
	// Add group
	// -------------------------------------------------------------------------
	$addBtn.on( 'click', function () {
		var gi   = $groupsWrap.find( '.wc-fabric-swatches-group' ).length;
		var attr = $attrSelect.val();
		$groupsWrap.append( buildGroupHtml( gi, {}, attr ) );
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
	// Toggle group body
	// -------------------------------------------------------------------------
	$( document ).on( 'click', '.wc-fabric-swatches-group-header', function ( e ) {
		if ( $( e.target ).is( 'button' ) || $( e.target ).closest( '.wc-fabric-swatches-group-actions' ).length ) {
			return;
		}
		$( this ).closest( '.wc-fabric-swatches-group' )
			.find( '.wc-fabric-swatches-group-body' )
			.slideToggle( 200 );
	} );

	// Keep header title display in sync while typing
	$( document ).on( 'input', '.wc-fabric-swatches-group-title-input', function () {
		var val = $( this ).val().trim() || 'New Group';
		$( this ).closest( '.wc-fabric-swatches-group' )
			.find( '.wc-fabric-swatches-group-title-display' )
			.text( val );
	} );

	// -------------------------------------------------------------------------
	// Re-index after DOM changes
	// -------------------------------------------------------------------------
	function reIndex() {
		$groupsWrap.find( '.wc-fabric-swatches-group' ).each( function ( gi ) {
			$( this ).attr( 'data-group-index', gi );
			$( this ).find( '[name]' ).each( function () {
				$( this ).attr( 'name',
					$( this ).attr( 'name' )
						.replace( /fabric_swatch_groups\[\d+\]/, 'fabric_swatch_groups[' + gi + ']' )
				);
			} );
		} );
	}

	// -------------------------------------------------------------------------
	// HTML builders
	// -------------------------------------------------------------------------

	function buildGroupHtml( gi, group, attrTaxonomy ) {
		var title      = esc( group.title || '' );
		var desc       = esc( group.description || '' );
		var priceLabel = esc( group.price_label || '' );
		var termSlugs  = group.term_slugs || [];

		return (
			'<div class="wc-fabric-swatches-group" data-group-index="' + gi + '">' +
				'<div class="wc-fabric-swatches-group-header">' +
					'<span class="wc-fabric-swatches-group-title-display">' + ( title || 'New Group' ) + '</span>' +
					'<span class="wc-fabric-swatches-group-actions">' +
						'<button type="button" class="button-link wc-fabric-swatches-toggle-group">Toggle</button>' +
						'<button type="button" class="button-link-delete wc-fabric-swatches-remove-group">Remove</button>' +
					'</span>' +
				'</div>' +
				'<div class="wc-fabric-swatches-group-body">' +
					'<div class="wc-fabric-swatches-group-fields">' +
						'<div class="wc-fabric-swatches-field">' +
							'<label>Group Title</label>' +
							'<input type="text" name="fabric_swatch_groups[' + gi + '][title]" value="' + title + '" class="wc-fabric-swatches-group-title-input regular-text" placeholder="e.g. Category A">' +
						'</div>' +
						'<div class="wc-fabric-swatches-field">' +
							'<label>Price Label</label>' +
							'<input type="text" name="fabric_swatch_groups[' + gi + '][price_label]" value="' + priceLabel + '" class="regular-text" placeholder="e.g. From £X">' +
						'</div>' +
						'<div class="wc-fabric-swatches-field wc-fabric-swatches-field--full">' +
							'<label>Description</label>' +
							'<textarea name="fabric_swatch_groups[' + gi + '][description]" rows="2" class="large-text" placeholder="Optional description">' + desc + '</textarea>' +
						'</div>' +
					'</div>' +
					'<div class="wc-fabric-swatches-terms-list">' +
						buildTermCheckboxes( gi, attrTaxonomy, termSlugs ) +
					'</div>' +
				'</div>' +
			'</div>'
		);
	}

	function buildTermCheckboxes( gi, attrTaxonomy, selectedSlugs ) {
		var attr  = wcFabricSwatchesAdmin.attributes[ attrTaxonomy ];
		var terms = attr ? attr.terms : [];

		if ( ! terms || ! terms.length ) {
			return '<p class="description">' + wcFabricSwatchesAdmin.noTerms + '</p>';
		}

		var html = '<p class="wc-fabric-swatches-terms-label">' + wcFabricSwatchesAdmin.termsLabel + '</p>' +
			'<div class="wc-fabric-swatches-terms-grid">';

		terms.forEach( function ( term ) {
			var checked = selectedSlugs.indexOf( term.slug ) !== -1 ? ' checked' : '';
			var preview = '';

			if ( term.imageUrl ) {
				preview = '<img src="' + esc( term.imageUrl ) + '" alt="' + esc( term.name ) + '">';
			} else if ( term.color ) {
				preview = '<span class="wc-fabric-term-color" style="background:' + esc( term.color ) + '"></span>';
			} else {
				preview = '<span class="wc-fabric-term-placeholder"></span>';
			}

			html +=
				'<label class="wc-fabric-term-option">' +
					'<input type="checkbox" name="fabric_swatch_groups[' + gi + '][term_slugs][]" value="' + esc( term.slug ) + '"' + checked + '>' +
					'<span class="wc-fabric-term-preview">' + preview + '</span>' +
					'<span class="wc-fabric-term-name">' + esc( term.name ) + '</span>' +
				'</label>';
		} );

		html += '</div>';
		return html;
	}

	// -------------------------------------------------------------------------
	// Minimal HTML escaping for dynamic content
	// -------------------------------------------------------------------------
	function esc( str ) {
		return String( str )
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#x27;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}
} );

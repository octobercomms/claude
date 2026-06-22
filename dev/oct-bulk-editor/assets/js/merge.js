/**
 * Merge Products screen.
 */
( function ( $ ) {
	'use strict';

	var selected = {}; // id -> { name, model, type, variations }
	var baseId   = 0;

	var $list      = $( '#octwbe-merge-list' );
	var $selBody   = $( '#octwbe-merge-selected-body' );
	var $status    = $( '#octwbe-merge-status' );
	var $previewBox= $( '#octwbe-merge-previewbox' );
	var $confirm   = $( '.octwbe-merge-confirm' );

	function showStatus( msg, type ) {
		$status.removeClass( 'is-success is-error is-info' )
			.addClass( 'is-' + ( type || 'info' ) ).text( msg ).show();
	}
	function hideStatus() { $status.hide().text( '' ); }

	function esc( s ) { return $( '<div>' ).text( s == null ? '' : s ).html(); }

	/* ---- Load product list ---- */
	function loadList( search ) {
		$list.html( '<p class="octwbe-merge-loading">Loading…</p>' );
		$.post( octwbeMerge.ajaxUrl, {
			action: 'octwbe_merge_list',
			nonce:  octwbeMerge.nonce,
			search: search || '',
		} ).done( function ( res ) {
			if ( ! res.success ) { $list.html( '<p>Error loading products.</p>' ); return; }
			renderList( res.data.items );
		} ).fail( function () { $list.html( '<p>Request failed.</p>' ); } );
	}

	function renderList( items ) {
		if ( ! items.length ) { $list.html( '<p>No products found.</p>' ); return; }
		var html = '';
		items.forEach( function ( it ) {
			var meta = it.type === 'variable' ? ( it.variations + ' variations' ) : it.type;
			html += '<label class="octwbe-merge-item">' +
				'<input type="checkbox" class="octwbe-merge-cb" value="' + it.id + '"' +
					' data-name="' + esc( it.name ) + '" data-type="' + esc( it.type ) + '" data-variations="' + it.variations + '"' +
					( selected[ it.id ] ? ' checked' : '' ) + ' />' +
				'<span class="octwbe-merge-item-name">' + esc( it.name ) + '</span>' +
				'<span class="octwbe-merge-item-meta">' + esc( meta ) + '</span>' +
				'</label>';
		} );
		$list.html( html );
	}

	/* ---- Selection ---- */
	$list.on( 'change', '.octwbe-merge-cb', function () {
		var id = $( this ).val();
		if ( this.checked ) {
			selected[ id ] = {
				name:       $( this ).data( 'name' ),
				model:      $( this ).data( 'name' ),
				type:       $( this ).data( 'type' ),
				variations: $( this ).data( 'variations' ),
			};
			if ( ! baseId ) { baseId = id; }
		} else {
			delete selected[ id ];
			if ( String( baseId ) === String( id ) ) {
				baseId = Object.keys( selected )[ 0 ] || 0;
			}
		}
		renderSelected();
		resetPreview();
	} );

	function renderSelected() {
		var ids = Object.keys( selected );
		if ( ! ids.length ) {
			$selBody.html( '<tr class="octwbe-merge-empty"><td colspan="3">No products selected yet.</td></tr>' );
			return;
		}
		var html = '';
		ids.forEach( function ( id ) {
			var s = selected[ id ];
			html += '<tr data-id="' + id + '">' +
				'<td>' + esc( s.name ) + '</td>' +
				'<td><input type="text" class="octwbe-merge-model widefat" value="' + esc( s.model ) + '" /></td>' +
				'<td style="text-align:center"><input type="radio" name="octwbe-merge-base" class="octwbe-merge-base" value="' + id + '"' +
					( String( baseId ) === String( id ) ? ' checked' : '' ) + ' /></td>' +
				'</tr>';
		} );
		$selBody.html( html );
	}

	$selBody.on( 'input', '.octwbe-merge-model', function () {
		var id = $( this ).closest( 'tr' ).data( 'id' );
		if ( selected[ id ] ) { selected[ id ].model = $( this ).val(); }
		resetPreview();
	} );
	$selBody.on( 'change', '.octwbe-merge-base', function () {
		baseId = $( this ).val();
	} );

	function collectPayload() {
		var sources = [], models = {};
		Object.keys( selected ).forEach( function ( id ) {
			sources.push( id );
			models[ id ] = selected[ id ].model;
		} );
		return { sources: sources, models: models };
	}

	function resetPreview() {
		$previewBox.hide().empty();
		$confirm.hide();
		$( '#octwbe-merge-run' ).prop( 'disabled', true );
		$( '#octwbe-merge-backup' ).prop( 'checked', false );
	}

	/* ---- Preview ---- */
	$( '#octwbe-merge-preview' ).on( 'click', function () {
		if ( Object.keys( selected ).length < 2 ) {
			showStatus( 'Select at least two products to merge.', 'error' );
			return;
		}
		hideStatus();
		var payload = collectPayload();
		$.post( octwbeMerge.ajaxUrl, $.extend( {
			action: 'octwbe_merge_preview',
			nonce:  octwbeMerge.nonce,
		}, payload ) ).done( function ( res ) {
			if ( ! res.success ) { showStatus( res.data || 'Preview failed.', 'error' ); return; }
			renderPreview( res.data );
		} ).fail( function () { showStatus( 'Preview request failed.', 'error' ); } );
	} );

	function renderPreview( data ) {
		var html = '<h3>Preview</h3>';
		html += '<p>This will create <strong>1 variable product</strong> with <strong>' +
			data.variations + ' variations</strong>.</p>';

		html += '<p><strong>Attributes &amp; dropdowns:</strong></p><ul class="octwbe-merge-ul">';
		data.attributes.forEach( function ( a ) {
			html += '<li>' + esc( a.label ) + ' — ' + a.values + ' option' + ( a.values !== 1 ? 's' : '' ) + '</li>';
		} );
		html += '</ul>';

		html += '<p><strong>Sources (→ Model):</strong></p><ul class="octwbe-merge-ul">';
		data.sources.forEach( function ( s ) {
			html += '<li>' + esc( s.name ) + ' → <em>' + esc( s.model ) + '</em> (' + s.variations + ' variation' + ( s.variations !== 1 ? 's' : '' ) + ')</li>';
		} );
		html += '</ul>';

		$previewBox.html( html ).show();
		$confirm.show();
	}

	/* ---- Confirm + run ---- */
	$( '#octwbe-merge-backup' ).on( 'change', function () {
		$( '#octwbe-merge-run' ).prop( 'disabled', ! this.checked );
	} );

	$( '#octwbe-merge-run' ).on( 'click', function () {
		var title = $( '#octwbe-merge-title' ).val().trim();
		if ( ! title ) { showStatus( 'Enter a name for the merged product.', 'error' ); return; }

		var $btn = $( this ).prop( 'disabled', true ).text( 'Merging…' );
		showStatus( 'Merging…', 'info' );

		var payload = collectPayload();
		$.post( octwbeMerge.ajaxUrl, $.extend( {
			action:         'octwbe_merge_run',
			nonce:          octwbeMerge.nonce,
			title:          title,
			base:           baseId,
			confirm_backup: 1,
		}, payload ) ).done( function ( res ) {
			$btn.text( 'Create merged product' );
			if ( ! res.success ) {
				showStatus( res.data || 'Merge failed.', 'error' );
				$btn.prop( 'disabled', false );
				return;
			}
			var d = res.data;
			var msg = 'Created merged product with ' + d.created + ' variations. ';
			if ( d.warnings && d.warnings.length ) {
				msg += ' (' + d.warnings.length + ' warning' + ( d.warnings.length !== 1 ? 's' : '' ) + ')';
			}
			showStatus( msg, 'success' );
			$previewBox.append(
				'<p><a class="button button-primary" href="' + d.edit_url + '">Edit merged product (draft) →</a></p>' +
				( d.warnings && d.warnings.length ? '<ul class="octwbe-merge-ul">' + d.warnings.map( function ( w ) { return '<li>' + esc( w ) + '</li>'; } ).join( '' ) + '</ul>' : '' )
			);
			$confirm.hide();
		} ).fail( function () {
			$btn.text( 'Create merged product' ).prop( 'disabled', false );
			showStatus( 'Merge request failed.', 'error' );
		} );
	} );

	/* ---- Search ---- */
	var searchTimer;
	$( '#octwbe-merge-search' ).on( 'input', function () {
		var v = $( this ).val().trim();
		clearTimeout( searchTimer );
		searchTimer = setTimeout( function () { loadList( v ); }, 300 );
	} );

	loadList( '' );
}( jQuery ) );

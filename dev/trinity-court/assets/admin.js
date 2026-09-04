/* Trinity Court Projects — admin: quote document picker via WP media library. */
( function ( $ ) {
	'use strict';

	function ids() {
		var v = $( '#tcp_quote_docs' ).val();
		return v ? v.split( ',' ).filter( Boolean ) : [];
	}
	function setIds( arr ) {
		$( '#tcp_quote_docs' ).val( arr.join( ',' ) );
	}

	$( document ).on( 'click', '#tcp_add_doc', function ( e ) {
		e.preventDefault();
		var frame = wp.media( {
			title: 'Select or upload the quote document',
			button: { text: 'Attach to project' },
			multiple: true
		} );
		frame.on( 'select', function () {
			var current = ids();
			frame.state().get( 'selection' ).each( function ( att ) {
				var a = att.toJSON();
				if ( current.indexOf( String( a.id ) ) === -1 ) {
					current.push( String( a.id ) );
					var name = a.title || a.filename || ( 'Document ' + a.id );
					$( '.tcp-doc-list' ).append(
						'<li data-id="' + a.id + '"><span class="dashicons dashicons-media-document"></span> ' +
						'<a href="' + a.url + '" target="_blank" rel="noopener">' + $( '<div>' ).text( name ).html() + '</a> ' +
						'<button type="button" class="button-link tcp-doc-remove" aria-label="Remove">&times;</button></li>'
					);
				}
			} );
			setIds( current );
		} );
		frame.open();
	} );

	$( document ).on( 'click', '.tcp-doc-remove', function ( e ) {
		e.preventDefault();
		var li = $( this ).closest( 'li' );
		var id = String( li.data( 'id' ) );
		setIds( ids().filter( function ( x ) { return x !== id; } ) );
		li.remove();
	} );
} )( jQuery );

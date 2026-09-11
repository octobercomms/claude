/* Trinity Court Projects — populate Quick Edit fields from the row's data. */
( function ( $ ) {
	'use strict';

	if ( typeof inlineEditPost === 'undefined' ) {
		return;
	}

	var $original = inlineEditPost.edit;

	inlineEditPost.edit = function ( id ) {
		$original.apply( this, arguments );

		var postId = 0;
		if ( typeof id === 'object' ) {
			postId = parseInt( this.getId( id ), 10 );
		}
		if ( ! postId ) {
			return;
		}

		var $row  = $( '#post-' + postId );
		var $edit = $( '#edit-' + postId );
		var data  = $row.find( '.tcp-inline-data' );
		if ( ! data.length ) {
			return;
		}

		$edit.find( '.tcp-q-ref' ).val( data.data( 'ref' ) );
		$edit.find( '.tcp-q-location' ).val( data.data( 'location' ) );
		$edit.find( '.tcp-q-cost' ).val( data.attr( 'data-cost' ) );
		$edit.find( '.tcp-q-votes' ).val( data.attr( 'data-votes' ) );
		$edit.find( '.tcp-q-status' ).val( data.attr( 'data-status' ) || 'not-started' );
		$edit.find( '.tcp-q-priority' ).val( data.attr( 'data-priority' ) || 'tbc' );
	};
} )( jQuery );

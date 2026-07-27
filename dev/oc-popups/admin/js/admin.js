/**
 * Popup Settings meta box: show only the fields relevant to the chosen
 * trigger / frequency / targeting option.
 */
( function () {
	'use strict';

	function byId( id ) {
		return document.getElementById( id );
	}

	function toggleTrigger() {
		var type = byId( 'ocpop_trigger_type' ).value;
		var rows = document.querySelectorAll( '.ocpop-when' );
		rows.forEach( function ( row ) {
			row.style.display = row.classList.contains( 'ocpop-when-' + type ) ? '' : 'none';
		} );
		// Per-trigger help notes inside the shared row.
		[ 'exit', 'load', 'manual' ].forEach( function ( t ) {
			var note = document.querySelector( '.ocpop-note-' + t );
			if ( note ) {
				note.style.display = ( type === t ) ? '' : 'none';
			}
		} );
	}

	function toggleFreq() {
		var val = byId( 'ocpop_frequency' ).value;
		document.querySelectorAll( '.ocpop-freq-days' ).forEach( function ( row ) {
			row.style.display = ( val === 'days' ) ? '' : 'none';
		} );
	}

	function toggleTarget() {
		var val = byId( 'ocpop_display_on' ).value;
		var row = document.querySelector( '.ocpop-target-ids' );
		if ( row ) {
			row.style.display = ( val === 'selected' || val === 'exclude' ) ? '' : 'none';
		}
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		if ( ! byId( 'ocpop_trigger_type' ) ) {
			return;
		}
		byId( 'ocpop_trigger_type' ).addEventListener( 'change', toggleTrigger );
		byId( 'ocpop_frequency' ).addEventListener( 'change', toggleFreq );
		byId( 'ocpop_display_on' ).addEventListener( 'change', toggleTarget );
		toggleTrigger();
		toggleFreq();
		toggleTarget();
	} );
} )();

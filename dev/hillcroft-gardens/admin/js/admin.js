/* Hillcroft Garden Designer — admin helpers. Kept tiny for the foundation build. */
( function () {
	'use strict';

	// Live-sync the deposit/commencement/completion percentages so they total 100.
	document.addEventListener( 'DOMContentLoaded', function () {
		var fields = [ 'deposit_pct', 'commencement_pct', 'completion_pct' ]
			.map( function ( n ) { return document.querySelector( '[name="' + n + '"]' ); } )
			.filter( Boolean );

		if ( fields.length === 3 ) {
			var note = document.createElement( 'p' );
			note.className = 'hgd-muted';
			var render = function () {
				var total = fields.reduce( function ( sum, f ) { return sum + ( parseFloat( f.value ) || 0 ); }, 0 );
				note.textContent = 'Milestone split totals ' + total + '%' + ( total === 100 ? ' ✓' : ' — should total 100%' );
				note.style.color = total === 100 ? '' : '#9b2c2c';
			};
			fields.forEach( function ( f ) { f.addEventListener( 'input', render ); } );
			fields[ 2 ].closest( '.hgd-grid' ).after( note );
			render();
		}
	} );
}() );

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

/* Image lightbox — click any render/asset thumbnail to view it full size. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var links = document.querySelectorAll( 'a[data-hgd-lightbox]' );
		if ( ! links.length ) { return; }

		var overlay = document.createElement( 'div' );
		overlay.className = 'hgd-lightbox';
		overlay.innerHTML = '<button type="button" class="hgd-lightbox-close" aria-label="Close">×</button><img alt="" />';
		document.body.appendChild( overlay );
		var img = overlay.querySelector( 'img' );

		function open( src ) {
			if ( ! src ) { return; }
			img.src = src;
			overlay.classList.add( 'is-open' );
			document.body.style.overflow = 'hidden';
		}
		function close() {
			overlay.classList.remove( 'is-open' );
			img.src = '';
			document.body.style.overflow = '';
		}

		links.forEach( function ( a ) {
			a.addEventListener( 'click', function ( e ) {
				if ( a.getAttribute( 'href' ) ) { e.preventDefault(); open( a.getAttribute( 'href' ) ); }
			} );
		} );
		overlay.addEventListener( 'click', function ( e ) {
			if ( e.target === overlay || e.target.classList.contains( 'hgd-lightbox-close' ) ) { close(); }
		} );
		document.addEventListener( 'keydown', function ( e ) {
			if ( 'Escape' === e.key && overlay.classList.contains( 'is-open' ) ) { close(); }
		} );
	} );
}() );

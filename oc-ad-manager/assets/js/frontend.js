( function () {
	'use strict';

	function loadAds() {
		var slots = document.querySelectorAll( '.ocad-ad-slot[data-format]' );
		if ( ! slots.length ) {
			return;
		}

		var restBase = ( typeof ocadFront !== 'undefined' && ocadFront.rest ) ? ocadFront.rest : '';
		if ( ! restBase ) {
			return;
		}

		slots.forEach( function ( slot ) {
			var format = slot.getAttribute( 'data-format' );
			if ( ! format ) {
				return;
			}

			fetch( restBase + 'ocad/v1/render?format=' + encodeURIComponent( format ), {
				credentials: 'omit',
				cache: 'no-store'
			} )
				.then( function ( r ) {
					return r.ok ? r.json() : null;
				} )
				.then( function ( data ) {
					if ( data && data.html ) {
						slot.innerHTML = data.html;
						slot.style.minHeight = '';
					}
				} )
				.catch( function () {} );
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', loadAds );
	} else {
		loadAds();
	}
} )();

( function () {
	'use strict';

	var restBase = ( typeof ocadFront !== 'undefined' && ocadFront.rest ) ? ocadFront.rest : '';

	// Load ad HTML into each placeholder slot via REST (bypasses page cache).
	function loadAds() {
		var slots = document.querySelectorAll( '.ocad-ad-slot[data-format]' );
		if ( ! slots.length || ! restBase ) {
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

	// Track ad clicks via a keepalive fetch beacon so the request survives page navigation.
	document.addEventListener( 'click', function ( e ) {
		if ( ! restBase ) {
			return;
		}
		var target = e.target;
		var a = null;
		while ( target && target !== document ) {
			if ( target.tagName === 'A' && target.hasAttribute( 'data-ocad-click' ) ) {
				a = target;
				break;
			}
			target = target.parentNode;
		}
		if ( ! a ) {
			return;
		}
		var adId = a.getAttribute( 'data-ocad-click' );
		if ( adId ) {
			fetch( restBase + 'ocad/v1/track-click?id=' + encodeURIComponent( adId ), {
				method: 'GET',
				keepalive: true,
				credentials: 'omit',
				cache: 'no-store'
			} ).catch( function () {} );
		}
	} );

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', loadAds );
	} else {
		loadAds();
	}
} )();

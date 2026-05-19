( function () {
	'use strict';

	// Load ad HTML into every placeholder slot.
	// The render URL is baked into data-render at PHP render time, so it works
	// correctly even when the page itself is served from a cache.
	function loadAds() {
		var slots = document.querySelectorAll( '.ocad-ad-slot[data-render]' );
		if ( ! slots.length ) {
			return;
		}

		slots.forEach( function ( slot ) {
			var url = slot.getAttribute( 'data-render' );
			if ( ! url ) {
				return;
			}

			fetch( url, { credentials: 'omit', cache: 'no-store' } )
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

	// Track ad clicks via a keepalive beacon.
	// The absolute track URL is embedded in data-ocad-track on each ad's <a> tag
	// by the hub's render endpoint, so partner pages send beacons to the hub directly.
	document.addEventListener( 'click', function ( e ) {
		var target = e.target;
		while ( target && target !== document ) {
			if ( target.tagName === 'A' && target.hasAttribute( 'data-ocad-track' ) ) {
				var trackUrl = target.getAttribute( 'data-ocad-track' );
				if ( trackUrl ) {
					fetch( trackUrl, {
						method: 'GET',
						keepalive: true,
						credentials: 'omit',
						cache: 'no-store'
					} ).catch( function () {} );
				}
				break;
			}
			target = target.parentNode;
		}
	} );

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', loadAds );
	} else {
		loadAds();
	}
} )();

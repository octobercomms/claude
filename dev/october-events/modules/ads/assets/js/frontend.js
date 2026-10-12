( function () {
	'use strict';

	function loadAds() {
		var slots = document.querySelectorAll( '.ocad-ad-slot[data-render]' );
		if ( ! slots.length ) {
			return;
		}

		var pageUrl = encodeURIComponent( window.location.href );

		slots.forEach( function ( slot ) {
			var url = slot.getAttribute( 'data-render' );
			if ( ! url ) {
				return;
			}

			// Append source (current page) for impression tracking, plus timestamp to bust cache.
			var fetchUrl = url
				+ ( url.indexOf( '?' ) !== -1 ? '&' : '?' )
				+ 'source=' + pageUrl
				+ '&_=' + Date.now();

			fetch( fetchUrl, { credentials: 'omit' } )
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

	// Track ad clicks via a keepalive beacon, including the current page URL.
	document.addEventListener( 'click', function ( e ) {
		var target = e.target;
		while ( target && target !== document ) {
			if ( target.tagName === 'A' && target.hasAttribute( 'data-ocad-track' ) ) {
				var trackUrl = target.getAttribute( 'data-ocad-track' );
				if ( trackUrl ) {
					trackUrl += ( trackUrl.indexOf( '?' ) !== -1 ? '&' : '?' )
						+ 'page=' + encodeURIComponent( window.location.href );
					fetch( trackUrl, {
						method: 'GET',
						keepalive: true,
						credentials: 'omit',
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

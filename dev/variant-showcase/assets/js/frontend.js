/**
 * Lifestyle hover — JS fallback.
 *
 * When the theme renders catalogue thumbnails in a way the PHP image filters
 * can't intercept, this attaches the hover overlay directly in the rendered
 * DOM. It finds each product/variation card (by the WordPress `post-<id>` class,
 * falling back to the product link URL), then wraps its image in the same
 * `.acvs-image-swap` markup the PHP path produces, so the CSS crossfade applies.
 *
 * It is a no-op for cards already wrapped server-side.
 */
( function () {
	'use strict';

	function sameUrl( a, b ) {
		try {
			var ua = new URL( a, window.location.href );
			var ub = new URL( b, window.location.href );
			return ua.pathname === ub.pathname && ua.search === ub.search;
		} catch ( e ) {
			return a === b;
		}
	}

	function findImage( id, entry ) {
		// Primary: the card container carries the WP post_class "post-<id>".
		var card = document.querySelector( '.post-' + id );
		if ( card ) {
			var img = card.querySelector( 'img' );
			if ( img ) {
				return img;
			}
		}
		// Fallback: match the product link by URL and take the image inside it.
		if ( entry.href ) {
			var anchors = document.querySelectorAll( 'a[href]' );
			for ( var i = 0; i < anchors.length; i++ ) {
				if ( sameUrl( anchors[ i ].href, entry.href ) ) {
					var aImg = anchors[ i ].querySelector( 'img' );
					if ( aImg ) {
						return aImg;
					}
				}
			}
		}
		return null;
	}

	function wrapImage( img, lifestyleUrl ) {
		if ( ! img || ( img.closest && img.closest( '.acvs-image-swap' ) ) ) {
			return;
		}
		var wrap = document.createElement( 'span' );
		wrap.className = 'acvs-image-swap';
		img.parentNode.insertBefore( wrap, img );
		wrap.appendChild( img );

		var life = document.createElement( 'img' );
		life.className = 'acvs-lifestyle-image';
		life.src = lifestyleUrl;
		life.alt = '';
		life.loading = 'lazy';
		life.setAttribute( 'aria-hidden', 'true' );
		wrap.appendChild( life );
	}

	function init() {
		var data = window.acvsLifestyle;
		if ( ! data ) {
			return;
		}
		Object.keys( data ).forEach( function ( id ) {
			var entry = data[ id ];
			if ( entry && entry.img ) {
				wrapImage( findImage( id, entry ), entry.img );
			}
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
}() );

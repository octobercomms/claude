( function () {
	'use strict';

	// The ONLY job of this script: drive the collapsible "Advanced" menu group.
	// Everything else (skin, menu order, branding) is server-rendered in PHP/CSS
	// so the page arrives correct — no flash, no layout shift, nothing to repaint.

	var STORAGE_KEY = 'octoberAdminAdvancedOpen';

	function init() {
		var menu = document.getElementById( 'adminmenu' );
		if ( ! menu ) {
			return;
		}

		// Restore the user's last choice (per browser) before first paint of the list.
		if ( safeGet( STORAGE_KEY ) === '1' ) {
			menu.classList.add( 'oc-advanced-open' );
		}

		var toggle = menu.querySelector( '.oc-advanced-toggle > a' );
		if ( ! toggle ) {
			return;
		}

		toggle.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			var open = menu.classList.toggle( 'oc-advanced-open' );
			safeSet( STORAGE_KEY, open ? '1' : '0' );
		} );
	}

	function safeGet( key ) {
		try {
			return window.localStorage.getItem( key );
		} catch ( err ) {
			return null;
		}
	}

	function safeSet( key, value ) {
		try {
			window.localStorage.setItem( key, value );
		} catch ( err ) {
			/* storage unavailable (private mode) — non-fatal */
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();

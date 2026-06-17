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

		setUtilityLinks( menu );

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

	// Point the sidebar's View Site / Log Out rows at their real URLs.
	function setUtilityLinks( menu ) {
		var data = window.octoberAdmin || {};
		var viewSite = menu.querySelector( '.oc-view-site-item > a' );
		var logOut = menu.querySelector( '.oc-log-out-item > a' );
		if ( viewSite && data.homeUrl ) {
			viewSite.setAttribute( 'href', data.homeUrl );
			viewSite.setAttribute( 'target', '_blank' );
			viewSite.setAttribute( 'rel', 'noopener' );
		}
		if ( logOut && data.logoutUrl ) {
			logOut.setAttribute( 'href', data.logoutUrl );
		}
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

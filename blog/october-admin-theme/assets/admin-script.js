( function () {
	'use strict';

	// Apply theme as soon as DOM is ready (before full load) to avoid FOUC
	document.documentElement.classList.add( 'claude-theme' );

	document.addEventListener( 'DOMContentLoaded', function () {
		enhanceMenuSections();
		enhanceTableRows();
		addSidebarBrand();
	} );

	// Add subtle section dividers to the admin menu based on WP menu separators
	function enhanceMenuSections() {
		var separators = document.querySelectorAll( '#adminmenu li.wp-menu-separator' );
		separators.forEach( function ( sep ) {
			sep.style.margin = '4px 0';
		} );
	}

	// Add stripe to currently-active table row for clarity
	function enhanceTableRows() {
		var rows = document.querySelectorAll( '.wp-list-table tbody tr' );
		rows.forEach( function ( row ) {
			row.addEventListener( 'mouseenter', function () {
				this.style.transition = 'background .1s ease';
			} );
		} );
	}

	// Inject a small "OC" wordmark at the top of the sidebar above the menu
	function addSidebarBrand() {
		var menu = document.getElementById( 'adminmenu' );
		if ( ! menu ) return;

		var brand = document.createElement( 'div' );
		brand.id = 'oc-sidebar-brand';
		brand.innerHTML = [
			'<div style="',
				'display:flex;align-items:center;gap:10px;',
				'padding:18px 14px 14px;',
				'border-bottom:1px solid rgba(255,255,255,.07);',
				'margin-bottom:6px;',
			'">',
				'<div style="',
					'width:32px;height:32px;border-radius:8px;',
					'background:#d4763b;',
					'display:flex;align-items:center;justify-content:center;',
					'font-family:Inter,system-ui,sans-serif;',
					'font-size:14px;font-weight:700;color:#fff;',
					'flex-shrink:0;letter-spacing:-0.5px;',
				'">OC</div>',
				'<span style="',
					'font-family:Inter,system-ui,sans-serif;',
					'font-size:13px;font-weight:600;',
					'color:#e8e0d8;letter-spacing:-0.2px;',
				'">October Comms</span>',
			'</div>',
		].join( '' );

		menu.parentNode.insertBefore( brand, menu );
	}
} )();

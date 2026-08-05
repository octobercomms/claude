/**
 * Blog Autopilot admin — polls the "Learn my site" background job and refreshes
 * the page when it finishes. No dependencies.
 */
( function () {
	'use strict';

	var el = document.getElementById( 'octobermi-learn-status' );
	if ( ! el || el.getAttribute( 'data-running' ) !== '1' ) {
		return;
	}
	if ( typeof OctoberMIBlog === 'undefined' ) {
		return;
	}

	var noteEl = el.querySelector( '.octobermi-learn-note' );
	var pctEl  = el.querySelector( '.octobermi-learn-pct' );

	function poll() {
		var body = new FormData();
		body.append( 'action', 'octobermi_blog_job_status' );
		body.append( 'nonce', OctoberMIBlog.nonce );

		fetch( OctoberMIBlog.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( res ) {
				if ( ! res || ! res.success ) { return; }
				var d = res.data || {};
				if ( d.status === 'running' || d.status === 'queued' ) {
					if ( noteEl && d.note ) { noteEl.textContent = d.note; }
					if ( pctEl && typeof d.progress !== 'undefined' ) { pctEl.textContent = d.progress; }
					window.setTimeout( poll, 2500 );
				} else {
					// done or error — reload to render the final state.
					window.location.reload();
				}
			} )
			.catch( function () { window.setTimeout( poll, 4000 ); } );
	}

	window.setTimeout( poll, 2000 );
} )();

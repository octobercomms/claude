/**
 * Blog Autopilot admin — polls any running background job on the page (learn the
 * site, generate a post) and refreshes when it finishes. No dependencies.
 */
( function () {
	'use strict';

	if ( typeof OctoberMIBlog === 'undefined' ) {
		return;
	}

	var pollers = document.querySelectorAll( '.octobermi-job-poll[data-running="1"]' );
	if ( ! pollers.length ) {
		return;
	}

	function watch( el ) {
		var type   = el.getAttribute( 'data-jobtype' );
		var noteEl = el.querySelector( '.octobermi-learn-note' );
		var pctEl  = el.querySelector( '.octobermi-learn-pct' );

		function poll() {
			var body = new FormData();
			body.append( 'action', 'octobermi_blog_job_status' );
			body.append( 'nonce', OctoberMIBlog.nonce );
			body.append( 'type', type );

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
	}

	Array.prototype.forEach.call( pollers, watch );
} )();

/* Hillcroft Garden Designer — admin helpers. Kept tiny for the foundation build. */
( function () {
	'use strict';

	// Live-sync the deposit/commencement/completion percentages so they total 100.
	document.addEventListener( 'DOMContentLoaded', function () {
		var fields = [ 'deposit_pct', 'commencement_pct', 'completion_pct' ]
			.map( function ( n ) { return document.querySelector( '[name="' + n + '"]' ); } )
			.filter( Boolean );

		if ( fields.length === 3 ) {
			var note = document.createElement( 'p' );
			note.className = 'hgd-muted';
			var render = function () {
				var total = fields.reduce( function ( sum, f ) { return sum + ( parseFloat( f.value ) || 0 ); }, 0 );
				note.textContent = 'Milestone split totals ' + total + '%' + ( total === 100 ? ' ✓' : ' — should total 100%' );
				note.style.color = total === 100 ? '' : '#9b2c2c';
			};
			fields.forEach( function ( f ) { f.addEventListener( 'input', render ); } );
			fields[ 2 ].closest( '.hgd-grid' ).after( note );
			render();
		}
	} );
}() );

/* Image lightbox — click any render/asset thumbnail to view it full size. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var links = document.querySelectorAll( 'a[data-hgd-lightbox]' );
		if ( ! links.length ) { return; }

		var overlay = document.createElement( 'div' );
		overlay.className = 'hgd-lightbox';
		overlay.innerHTML = '<button type="button" class="hgd-lightbox-close" aria-label="Close">×</button><img alt="" />';
		document.body.appendChild( overlay );
		var img = overlay.querySelector( 'img' );

		function open( src ) {
			if ( ! src ) { return; }
			img.src = src;
			overlay.classList.add( 'is-open' );
			document.body.style.overflow = 'hidden';
		}
		function close() {
			overlay.classList.remove( 'is-open' );
			img.src = '';
			document.body.style.overflow = '';
		}

		links.forEach( function ( a ) {
			a.addEventListener( 'click', function ( e ) {
				if ( a.getAttribute( 'href' ) ) { e.preventDefault(); open( a.getAttribute( 'href' ) ); }
			} );
		} );
		overlay.addEventListener( 'click', function ( e ) {
			if ( e.target === overlay || e.target.classList.contains( 'hgd-lightbox-close' ) ) { close(); }
		} );
		document.addEventListener( 'keydown', function ( e ) {
			if ( 'Escape' === e.key && overlay.classList.contains( 'is-open' ) ) { close(); }
		} );
	} );
}() );

/* Loading overlay for slow actions (Claude / Gemini can take ~60s). On submit
   of a known long-running form, lock the page with a branded spinner + message
   until it finishes (the action redirects + reloads the page on completion). */
( function () {
	'use strict';

	// action value -> message shown while it runs.
	var MESSAGES = {
		hgd_claude_read:     'Claude is reading your sketch and photos…',
		hgd_chat_send:       'Claude is thinking and updating your brief…',
		hgd_compose_prompt:  'Claude is composing the design brief…',
		hgd_generate_render: 'Generating your concept render… this can take up to a minute.',
		hgd_generate_plan:   'Generating your garden plan… this can take up to a minute.',
		hgd_compose_plan_prompt: 'Claude is drafting the plan…',
		hgd_pack_generate_view:  'Generating this view… this can take up to a minute.',
		hgd_pack_generate_all:   'Generating the full render pack… this can take a couple of minutes. Please keep this tab open.',
		hgd_pack_seasonal:       'Generating the seasonal views… this can take a minute or two.',
		hgd_pack_fetch_satellite:'Fetching the satellite view…',
		hgd_upload_assets:   'Uploading your images…',
		hgd_plants_import:   'Importing plants…',
		hgd_proposal_send:   'Sending the proposal…'
	};

	function buildOverlay() {
		var o = document.createElement( 'div' );
		o.className = 'hgd-loading';
		o.setAttribute( 'role', 'alert' );
		o.setAttribute( 'aria-live', 'assertive' );
		o.innerHTML = '<div class="hgd-loading-box">' +
			'<div class="hgd-spinner" aria-hidden="true"></div>' +
			'<p class="hgd-loading-msg"></p>' +
			'<p class="hgd-loading-sub">Please don’t close or refresh this page.</p>' +
			'</div>';
		return o;
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		var overlay = null;

		document.addEventListener( 'submit', function ( e ) {
			var form = e.target;
			if ( ! form || form.nodeName !== 'FORM' ) { return; }
			var actionField = form.querySelector( 'input[name="action"]' );
			if ( ! actionField ) { return; }
			var msg = MESSAGES[ actionField.value ];
			if ( ! msg ) { return; }

			if ( ! overlay ) { overlay = buildOverlay(); document.body.appendChild( overlay ); }
			overlay.querySelector( '.hgd-loading-msg' ).textContent = msg;
			overlay.classList.add( 'is-open' );
			document.body.style.overflow = 'hidden';

			// Disable the submit button to prevent double-clicks (after a tick so
			// the value still posts).
			var btn = form.querySelector( 'button[type="submit"], input[type="submit"]' );
			if ( btn ) { setTimeout( function () { btn.setAttribute( 'disabled', 'disabled' ); }, 10 ); }
		}, true );

		// If the user navigates back to a cached page, make sure the overlay is gone.
		window.addEventListener( 'pageshow', function () {
			if ( overlay ) { overlay.classList.remove( 'is-open' ); document.body.style.overflow = ''; }
		} );
	} );
}() );

/* Plant catalogue — Import CSV picker auto-submit. The visible "Import CSV" pill
   is a <label> for a hidden file input; selecting a file submits the form. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var input = document.querySelector( '[data-hgd-csv-auto]' );
		if ( ! input ) { return; }
		input.addEventListener( 'change', function () {
			if ( input.files && input.files.length && input.form ) {
				input.form.submit();
			}
		} );
	} );
}() );

/* Plant catalogue — click-to-expand rows. Clicking a plant row (or pressing Enter)
   toggles the detail row immediately below it. Clicks on the Edit/Delete/fetch
   controls are ignored so they keep their own behaviour. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var rows = document.querySelectorAll( '.hgd-plant-row' );
		if ( ! rows.length ) { return; }

		function toggle( row ) {
			var detail = row.nextElementSibling;
			if ( ! detail || ! detail.classList.contains( 'hgd-plant-detail' ) ) { return; }
			var open = detail.classList.toggle( 'is-open' );
			row.classList.toggle( 'is-open', open );
			row.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		}

		rows.forEach( function ( row ) {
			row.addEventListener( 'click', function ( e ) {
				if ( e.target.closest( '[data-hgd-no-expand]' ) ) { return; }
				toggle( row );
			} );
			row.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' ) {
					if ( e.target.closest( '[data-hgd-no-expand]' ) ) { return; }
					e.preventDefault();
					toggle( row );
				}
			} );
		} );
	} );
}() );

/* Plant edit — media-library image picker. Opens wp.media, sets the hidden
   image_id input + preview; Remove clears it. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var pick    = document.getElementById( 'hgd-image-pick' );
		var idField = document.getElementById( 'hgd-image-id' );
		var preview = document.getElementById( 'hgd-image-preview' );
		var remove  = document.getElementById( 'hgd-image-remove' );
		if ( ! pick || ! idField || ! preview ) { return; }
		if ( typeof window.wp === 'undefined' || ! window.wp.media ) { return; }

		var frame = null;

		function setPreview( html ) {
			preview.innerHTML = html;
		}

		pick.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			if ( ! frame ) {
				frame = window.wp.media( {
					title: 'Select a plant photo',
					button: { text: 'Use this photo' },
					library: { type: 'image' },
					multiple: false
				} );
				frame.on( 'select', function () {
					var att = frame.state().get( 'selection' ).first().toJSON();
					idField.value = att.id;
					var src = att.sizes && att.sizes.thumbnail ? att.sizes.thumbnail.url : att.url;
					setPreview( '<img src="' + src + '" alt="" />' );
					if ( remove ) { remove.classList.remove( 'hgd-hidden' ); }
				} );
			}
			frame.open();
		} );

		if ( remove ) {
			remove.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				idField.value = '0';
				setPreview( '<span class="hgd-plant-thumb hgd-plant-thumb-empty" aria-hidden="true">✿</span>' );
				remove.classList.add( 'hgd-hidden' );
			} );
		}
	} );
}() );

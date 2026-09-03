/**
 * Trinity Court Projects — front-end behaviour.
 * Vanilla JS, no dependencies. Handles expand/collapse, filter, sort,
 * voting and in-ticket comments.
 */
( function () {
	'use strict';

	var cfg = window.TCP || {};

	function ajax( action, data ) {
		var body = new URLSearchParams();
		body.append( 'action', action );
		body.append( 'nonce', cfg.nonce );
		Object.keys( data || {} ).forEach( function ( k ) {
			body.append( k, data[ k ] );
		} );
		return fetch( cfg.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		} ).then( function ( r ) {
			return r.json();
		} );
	}

	document.querySelectorAll( '.tcp-app' ).forEach( function ( app ) {
		initApp( app );
	} );

	function initApp( app ) {
		// Expand / collapse a card.
		app.addEventListener( 'click', function ( e ) {
			var toggle = e.target.closest( '.tcp-card-toggle' );
			if ( toggle ) {
				var card = toggle.closest( '.tcp-card' );
				var body = card.querySelector( '.tcp-card-body' );
				var open = toggle.getAttribute( 'aria-expanded' ) === 'true';
				toggle.setAttribute( 'aria-expanded', open ? 'false' : 'true' );
				body.hidden = open;
				card.classList.toggle( 'is-open', ! open );
			}
		} );

		// Voting.
		app.addEventListener( 'click', function ( e ) {
			var btn = e.target.closest( '.tcp-vote' );
			if ( ! btn ) {
				return;
			}
			e.preventDefault();
			if ( btn.disabled ) {
				return;
			}
			btn.disabled = true;
			ajax( 'tcp_vote', { id: btn.getAttribute( 'data-id' ) } ).then( function ( res ) {
				btn.disabled = false;
				if ( ! res || ! res.success ) {
					return;
				}
				btn.querySelector( '.tcp-vote-count' ).textContent = res.data.votes;
				btn.querySelector( '.tcp-vote-label' ).textContent = res.data.votes === 1 ? 'vote' : 'votes';
				btn.classList.toggle( 'is-voted', res.data.voted );
				btn.setAttribute( 'aria-pressed', res.data.voted ? 'true' : 'false' );
				btn.closest( '.tcp-card' ).setAttribute( 'data-votes', res.data.votes );
			} ).catch( function () {
				btn.disabled = false;
			} );
		} );

		// Comments: open panel + lazy-load on first open.
		app.addEventListener( 'click', function ( e ) {
			var toggle = e.target.closest( '.tcp-comments-toggle' );
			if ( ! toggle ) {
				return;
			}
			var wrap = toggle.closest( '.tcp-comments' );
			var panel = wrap.querySelector( '.tcp-comments-panel' );
			panel.hidden = ! panel.hidden;
			if ( ! panel.hidden && wrap.getAttribute( 'data-loaded' ) === '0' ) {
				wrap.setAttribute( 'data-loaded', '1' );
				var list = wrap.querySelector( '.tcp-comments-list' );
				list.innerHTML = '<p class="tcp-loading">Loading…</p>';
				ajax( 'tcp_get_comments', { id: wrap.getAttribute( 'data-id' ) } ).then( function ( res ) {
					list.innerHTML = ( res && res.success ) ? res.data.html : '<p>Could not load comments.</p>';
				} );
			}
		} );

		// Comment submit.
		app.addEventListener( 'submit', function ( e ) {
			var form = e.target.closest( '.tcp-comment-form' );
			if ( ! form ) {
				return;
			}
			e.preventDefault();
			var wrap = form.closest( '.tcp-comments' );
			var note = form.querySelector( '.tcp-comment-note' );
			var textEl = form.querySelector( '.tcp-comment-text' );
			var authorEl = form.querySelector( '.tcp-comment-author' );
			var submit = form.querySelector( '.tcp-comment-submit' );
			var payload = { id: wrap.getAttribute( 'data-id' ), comment: textEl.value };
			if ( authorEl ) {
				payload.author = authorEl.value;
			}
			submit.disabled = true;
			note.textContent = '';
			ajax( 'tcp_comment', payload ).then( function ( res ) {
				submit.disabled = false;
				if ( ! res || ! res.success ) {
					note.textContent = res && res.data ? res.data.message : 'Something went wrong.';
					note.className = 'tcp-comment-note is-error';
					return;
				}
				note.textContent = res.data.message;
				note.className = 'tcp-comment-note is-ok';
				textEl.value = '';
				if ( res.data.approved && res.data.html ) {
					var list = wrap.querySelector( '.tcp-comments-list' );
					var placeholder = list.querySelector( '.tcp-no-comments' );
					if ( placeholder ) {
						placeholder.remove();
					}
					list.insertAdjacentHTML( 'beforeend', res.data.html );
				}
				var counter = wrap.querySelector( '.tcp-comment-count' );
				if ( counter && typeof res.data.count !== 'undefined' ) {
					counter.textContent = res.data.count;
				}
			} ).catch( function () {
				submit.disabled = false;
				note.textContent = 'Network error. Please try again.';
				note.className = 'tcp-comment-note is-error';
			} );
		} );

		// Filtering.
		var filters = app.querySelectorAll( '.tcp-filter' );
		filters.forEach( function ( btn ) {
			btn.addEventListener( 'click', function () {
				filters.forEach( function ( b ) {
					b.classList.remove( 'is-active' );
				} );
				btn.classList.add( 'is-active' );
				applyFilter( app, btn.getAttribute( 'data-filter' ) );
			} );
		} );

		// Sorting.
		var sortSel = app.querySelector( '.tcp-sort-select' );
		if ( sortSel ) {
			sortSel.addEventListener( 'change', function () {
				applySort( app, sortSel.value );
			} );
		}
	}

	function applyFilter( app, filter ) {
		app.querySelectorAll( '.tcp-card' ).forEach( function ( card ) {
			var show = filter === 'all' || card.getAttribute( 'data-status' ) === filter;
			card.style.display = show ? '' : 'none';
		} );
		// Hide any group block left with no visible cards.
		app.querySelectorAll( '.tcp-group' ).forEach( function ( group ) {
			var visible = group.querySelectorAll( '.tcp-card:not([style*="display: none"])' ).length;
			group.style.display = visible ? '' : 'none';
		} );
	}

	function applySort( app, key ) {
		var lists = app.querySelectorAll( '.tcp-list' );
		lists.forEach( function ( list ) {
			var cards = Array.prototype.slice.call( list.querySelectorAll( '.tcp-card' ) );
			cards.sort( function ( a, b ) {
				switch ( key ) {
					case 'votes':
						return num( b, 'data-votes' ) - num( a, 'data-votes' );
					case 'priority':
						return num( b, 'data-priority' ) - num( a, 'data-priority' );
					case 'cost':
						return num( b, 'data-cost' ) - num( a, 'data-cost' );
					case 'status':
						return str( a, 'data-status' ).localeCompare( str( b, 'data-status' ) );
					default:
						return num( a, 'data-ref' ) - num( b, 'data-ref' );
				}
			} );
			cards.forEach( function ( c ) {
				list.appendChild( c );
			} );
		} );
	}

	function num( el, attr ) {
		return parseFloat( el.getAttribute( attr ) ) || 0;
	}
	function str( el, attr ) {
		return el.getAttribute( attr ) || '';
	}
} )();

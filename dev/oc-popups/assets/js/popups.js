/**
 * October Popups — frontend trigger engine.
 *
 * Reads per-popup config from the #ocpop-config JSON block, wires up the chosen
 * trigger, enforces frequency caps client-side (so page caching is irrelevant),
 * and reports impressions / CTA clicks back to the REST endpoint.
 */
( function () {
	'use strict';

	var cfg = readConfig();
	if ( ! cfg || ! cfg.popups || ! cfg.popups.length ) {
		return;
	}

	var trackUrl = cfg.trackUrl;
	var nonce = cfg.nonce;
	var isMobile = window.matchMedia( '(max-width: 768px)' ).matches;

	function readConfig() {
		var el = document.getElementById( 'ocpop-config' );
		if ( ! el ) {
			return null;
		}
		try {
			return JSON.parse( el.textContent );
		} catch ( e ) {
			return null;
		}
	}

	function key( id ) {
		return 'ocpop_seen_' + id;
	}

	/* --- Frequency ------------------------------------------------------- */

	function alreadyShown( p ) {
		try {
			if ( p.frequency === 'always' ) {
				return false;
			}
			if ( p.frequency === 'session' ) {
				return sessionStorage.getItem( key( p.id ) ) === '1';
			}
			var stamp = parseInt( localStorage.getItem( key( p.id ) ), 10 );
			if ( ! stamp ) {
				return false;
			}
			if ( p.frequency === 'once' ) {
				return true;
			}
			if ( p.frequency === 'days' ) {
				var ms = ( p.freqDays || 1 ) * 86400000;
				return ( Date.now() - stamp ) < ms;
			}
		} catch ( e ) {
			return false;
		}
		return false;
	}

	function markShown( p ) {
		try {
			if ( p.frequency === 'session' ) {
				sessionStorage.setItem( key( p.id ), '1' );
			} else if ( p.frequency !== 'always' ) {
				localStorage.setItem( key( p.id ), String( Date.now() ) );
			}
		} catch ( e ) {}
	}

	/* --- Tracking -------------------------------------------------------- */

	function track( id, event ) {
		if ( ! trackUrl ) {
			return;
		}
		var body = JSON.stringify( { id: id, event: event } );
		// Prefer sendBeacon so it survives navigation (CTA clicks).
		if ( navigator.sendBeacon ) {
			try {
				navigator.sendBeacon( trackUrl, new Blob( [ body ], { type: 'application/json' } ) );
				return;
			} catch ( e ) {}
		}
		fetch( trackUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
			body: body,
			keepalive: true
		} ).catch( function () {} );
	}

	/* --- Show / hide ----------------------------------------------------- */

	function show( p, wrap, opts ) {
		opts = opts || {};
		if ( wrap.getAttribute( 'data-ocpop-open' ) === '1' ) {
			return;
		}
		wrap.setAttribute( 'data-ocpop-open', '1' );
		wrap.hidden = false;
		// Force reflow so the CSS entry animation runs.
		void wrap.offsetWidth;
		wrap.classList.add( 'is-open' );
		document.documentElement.classList.add( 'ocpop-locked' );

		if ( ! opts.manual ) {
			markShown( p );
		}
		track( p.id, 'view' );

		// Delay the close button if configured.
		var closeBtn = wrap.querySelector( '.ocpop-close' );
		if ( closeBtn && p.closeDelay > 0 ) {
			closeBtn.style.visibility = 'hidden';
			setTimeout( function () {
				closeBtn.style.visibility = '';
			}, p.closeDelay * 1000 );
		}

		var dialog = wrap.querySelector( '.ocpop' );
		if ( dialog ) {
			dialog.setAttribute( 'tabindex', '-1' );
			dialog.focus( { preventScroll: true } );
		}
	}

	function hide( p, wrap ) {
		wrap.classList.remove( 'is-open' );
		wrap.setAttribute( 'data-ocpop-open', '0' );
		document.documentElement.classList.remove( 'ocpop-locked' );
		track( p.id, 'close' );
		setTimeout( function () {
			wrap.hidden = true;
		}, 300 );
	}

	/* --- Trigger wiring -------------------------------------------------- */

	function wireTrigger( p, wrap ) {
		var fire = function () {
			show( p, wrap );
		};

		switch ( p.trigger ) {
			case 'load':
				fire();
				break;

			case 'delay':
				setTimeout( fire, ( p.delay || 0 ) * 1000 );
				break;

			case 'scroll':
				var onScroll = function () {
					var doc = document.documentElement;
					var scrolled = ( doc.scrollTop || document.body.scrollTop );
					var height = doc.scrollHeight - doc.clientHeight;
					var pct = height > 0 ? ( scrolled / height ) * 100 : 100;
					if ( pct >= ( p.scroll || 50 ) ) {
						window.removeEventListener( 'scroll', onScroll );
						fire();
					}
				};
				window.addEventListener( 'scroll', onScroll, { passive: true } );
				break;

			case 'exit':
				// Exit intent is a desktop behaviour; skip on touch.
				if ( isMobile ) {
					break;
				}
				var onLeave = function ( e ) {
					if ( e.clientY <= 0 ) {
						document.removeEventListener( 'mouseout', onLeave );
						fire();
					}
				};
				document.addEventListener( 'mouseout', onLeave );
				break;

			case 'idle':
				var timer;
				var reset = function () {
					clearTimeout( timer );
					timer = setTimeout( function () {
						cleanup();
						fire();
					}, ( p.idle || 20 ) * 1000 );
				};
				var events = [ 'mousemove', 'keydown', 'scroll', 'touchstart', 'click' ];
				var cleanup = function () {
					clearTimeout( timer );
					events.forEach( function ( ev ) {
						window.removeEventListener( ev, reset );
					} );
				};
				events.forEach( function ( ev ) {
					window.addEventListener( ev, reset, { passive: true } );
				} );
				reset();
				break;

			case 'click':
				if ( p.selector ) {
					document.addEventListener( 'click', function ( e ) {
						if ( e.target.closest && e.target.closest( p.selector ) ) {
							e.preventDefault();
							show( p, wrap, { manual: true } );
						}
					} );
				}
				break;

			// 'manual' — nothing auto-fires; opened via .ocpop-open-<id>.
		}
	}

	/* --- Per-popup setup ------------------------------------------------- */

	cfg.popups.forEach( function ( p ) {
		var wrap = document.getElementById( 'ocpop-wrap-' + p.id );
		if ( ! wrap ) {
			return;
		}

		// Overlay styling from config.
		if ( p.overlay ) {
			var ov = wrap.querySelector( '.ocpop-overlay' );
			if ( ov && p.overlayColor ) {
				ov.style.background = p.overlayColor;
			}
		}

		// Close interactions.
		var closeBtn = wrap.querySelector( '.ocpop-close' );
		if ( closeBtn ) {
			closeBtn.addEventListener( 'click', function () {
				hide( p, wrap );
			} );
		}
		if ( p.overlayClose ) {
			var ov2 = wrap.querySelector( '.ocpop-overlay' );
			if ( ov2 ) {
				ov2.addEventListener( 'click', function () {
					hide( p, wrap );
				} );
			}
		}
		if ( p.escClose ) {
			document.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Escape' && wrap.getAttribute( 'data-ocpop-open' ) === '1' ) {
					hide( p, wrap );
				}
			} );
		}

		// CTA click tracking (links marked with .ocpop-cta).
		wrap.addEventListener( 'click', function ( e ) {
			var cta = e.target.closest && e.target.closest( '.ocpop-cta' );
			if ( cta ) {
				track( p.id, 'conversion' );
			}
		} );

		// Manual open buttons anywhere on the page.
		document.querySelectorAll( '.ocpop-open-' + p.id ).forEach( function ( btn ) {
			btn.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				show( p, wrap, { manual: true } );
			} );
		} );

		// Device gating + frequency only govern the AUTOMATIC trigger.
		var deviceOk = p.devices === 'all' || ( p.devices === 'mobile' ) === isMobile;
		if ( p.trigger !== 'manual' && deviceOk && ! alreadyShown( p ) ) {
			wireTrigger( p, wrap );
		}
	} );
} )();

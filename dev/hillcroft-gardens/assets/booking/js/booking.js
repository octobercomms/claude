/* Hillcroft Garden Designer — public booking flow.
 * Date -> time -> details -> embedded Stripe Payment Element -> success.
 */
( function () {
	'use strict';

	var root = document.querySelector( '.hgd-booking[data-configured="1"]' );
	if ( ! root || typeof HGD_BOOKING === 'undefined' ) {
		return;
	}

	var cfg = HGD_BOOKING;
	var wooMode = !! cfg.woo;
	// Bespoke Stripe path needs Stripe.js + a publishable key; Woo mode does not.
	if ( ! wooMode && ( typeof Stripe === 'undefined' || ! cfg.pub_key ) ) {
		return;
	}

	var state = { dates: [], date: null, slot: null, bookingId: null };
	var stripe = wooMode ? null : Stripe( cfg.pub_key );
	var elements = null;

	function panel( name ) { return root.querySelector( '[data-pane="' + name + '"]' ); }
	function show( name ) {
		root.querySelectorAll( '.hgd-booking-panel' ).forEach( function ( p ) { p.hidden = true; } );
		var p = panel( name );
		if ( p ) { p.hidden = false; }
		markSteps( name );
	}
	function markSteps( name ) {
		var order = [ 'date', 'slot', 'details', 'pay' ];
		var idx = order.indexOf( name );
		root.querySelectorAll( '.hgd-booking-steps li' ).forEach( function ( li ) {
			var step = li.getAttribute( 'data-step' );
			var sidx = order.indexOf( step );
			li.classList.remove( 'is-active', 'is-done' );
			if ( step === name ) { li.classList.add( 'is-active' ); }
			else if ( idx > -1 && sidx > -1 && sidx < idx ) { li.classList.add( 'is-done' ); }
		} );
	}

	function api( path, method, body ) {
		var opts = {
			method: method,
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce }
		};
		if ( body ) { opts.body = JSON.stringify( body ); }
		return fetch( cfg.rest + path, opts ).then( function ( r ) {
			return r.json().then( function ( data ) {
				return { ok: r.ok, status: r.status, data: data };
			} );
		} );
	}

	function loadSlots() {
		api( '/booking/slots', 'GET' ).then( function ( res ) {
			var loading = panel( 'date' ).querySelector( '.hgd-booking-loading' );
			if ( loading ) { loading.remove(); }
			if ( ! res.ok || ! res.data.dates || ! res.data.dates.length ) {
				renderDates( [] );
				return;
			}
			state.dates = res.data.dates;
			renderDates( state.dates );
		} ).catch( function () {
			var loading = panel( 'date' ).querySelector( '.hgd-booking-loading' );
			if ( loading ) { loading.textContent = cfg.i18n.error; }
		} );
	}

	function renderDates( dates ) {
		var wrap = panel( 'date' ).querySelector( '.hgd-booking-dates' );
		wrap.innerHTML = '';
		if ( ! dates.length ) {
			wrap.innerHTML = '<p class="hgd-booking-loading">No dates are currently available. Please check back soon.</p>';
			return;
		}
		dates.forEach( function ( d ) {
			var btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'hgd-booking-chip';
			btn.textContent = d.label;
			btn.addEventListener( 'click', function () {
				state.date = d;
				renderSlots( d );
				panel( 'slot' ).querySelector( '.hgd-booking-chosen-date' ).textContent = d.label;
				show( 'slot' );
			} );
			wrap.appendChild( btn );
		} );
	}

	function renderSlots( d ) {
		var wrap = panel( 'slot' ).querySelector( '.hgd-booking-slots' );
		wrap.innerHTML = '';
		d.slots.forEach( function ( s ) {
			var btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'hgd-booking-chip';
			btn.textContent = s.label;
			btn.addEventListener( 'click', function () {
				state.slot = s;
				panel( 'details' ).querySelector( '.hgd-booking-chosen-slot' ).textContent = d.label + ' · ' + s.label;
				show( 'details' );
			} );
			wrap.appendChild( btn );
		} );
	}

	function gatherDetails() {
		var fields = {};
		panel( 'details' ).querySelectorAll( 'input, textarea' ).forEach( function ( el ) {
			fields[ el.name ] = el.value.trim();
		} );
		return fields;
	}

	function setErr( pane, msg ) {
		var el = panel( pane ).querySelector( '.hgd-booking-err' );
		if ( ! el ) { return; }
		if ( msg ) { el.textContent = msg; el.hidden = false; }
		else { el.hidden = true; }
	}

	function startPayment() {
		var f = gatherDetails();
		setErr( 'details', '' );
		if ( ! f.name || ! f.email ) {
			setErr( 'details', 'Please enter your name and email.' );
			return;
		}
		var btn = panel( 'details' ).querySelector( '.hgd-booking-continue' );
		btn.disabled = true;

		api( '/booking/create', 'POST', {
			name: f.name, email: f.email, phone: f.phone, address: f.address,
			postcode: f.postcode, notes: f.notes,
			slot_start: state.slot.start, slot_end: state.slot.end
		} ).then( function ( res ) {
			btn.disabled = false;
			if ( ! res.ok ) {
				var msg = ( res.data && res.data.message ) ? res.data.message : ( res.status === 409 ? cfg.i18n.taken : cfg.i18n.error );
				setErr( 'details', msg );
				return;
			}
			state.bookingId = res.data.booking_id;

			// Woo mode: hand off to WooCommerce checkout for payment + receipt.
			if ( res.data.woo_pay_url ) {
				btn.disabled = true;
				btn.textContent = cfg.i18n.paying;
				window.location.href = res.data.woo_pay_url;
				return;
			}

			mountPaymentElement( res.data.client_secret, f );
			panel( 'pay' ).querySelector( '.hgd-booking-summary' ).textContent =
				state.date.label + ' · ' + state.slot.label + ' — £' + cfg.fee;
			show( 'pay' );
		} ).catch( function () {
			btn.disabled = false;
			setErr( 'details', cfg.i18n.error );
		} );
	}

	function mountPaymentElement( clientSecret, f ) {
		elements = stripe.elements( { clientSecret: clientSecret } );
		var paymentElement = elements.create( 'payment', {
			defaultValues: { billingDetails: { name: f.name, email: f.email } }
		} );
		var mount = panel( 'pay' ).querySelector( '.hgd-booking-payment-element' );
		mount.innerHTML = '';
		paymentElement.mount( mount );
	}

	function confirmPayment() {
		if ( ! elements ) { return; }
		setErr( 'pay', '' );
		var btn = panel( 'pay' ).querySelector( '.hgd-booking-pay' );
		var label = btn.textContent;
		btn.disabled = true;
		btn.textContent = cfg.i18n.paying;

		stripe.confirmPayment( {
			elements: elements,
			redirect: 'if_required'
		} ).then( function ( result ) {
			if ( result.error ) {
				setErr( 'pay', result.error.message || cfg.i18n.error );
				btn.disabled = false;
				btn.textContent = label;
				return;
			}
			if ( result.paymentIntent && result.paymentIntent.status === 'succeeded' ) {
				show( 'done' );
			} else {
				setErr( 'pay', cfg.i18n.error );
				btn.disabled = false;
				btn.textContent = label;
			}
		} ).catch( function () {
			setErr( 'pay', cfg.i18n.error );
			btn.disabled = false;
			btn.textContent = label;
		} );
	}

	// Wire up navigation.
	root.querySelectorAll( '.hgd-booking-back' ).forEach( function ( btn ) {
		btn.addEventListener( 'click', function () {
			var pane = btn.closest( '.hgd-booking-panel' ).getAttribute( 'data-pane' );
			if ( pane === 'slot' ) { show( 'date' ); }
			else if ( pane === 'details' ) { show( 'slot' ); }
			else if ( pane === 'pay' ) { show( 'details' ); }
		} );
	} );

	var cont = root.querySelector( '.hgd-booking-continue' );
	if ( cont ) { cont.addEventListener( 'click', startPayment ); }
	var pay = root.querySelector( '.hgd-booking-pay' );
	if ( pay ) { pay.addEventListener( 'click', confirmPayment ); }

	loadSlots();
} )();

/**
 * Maintenance-plan sign-up.
 *
 * Picking a plan reveals a short details form; submitting posts to the
 * checkout REST route and redirects the customer to Stripe's hosted Checkout,
 * which takes the card and starts the subscription.
 */
( function () {
	'use strict';

	var cfg = window.HGD_SUBS || {};
	var root = document.querySelector( '.hgd-subs' );
	if ( ! root || '1' !== root.getAttribute( 'data-configured' ) ) {
		return;
	}

	var grid  = root.querySelector( '.hgd-subs-grid' );
	var form  = root.querySelector( '.hgd-subs-form' );
	var error = root.querySelector( '.hgd-subs-error' );
	var planInput = form.querySelector( 'input[name="plan_key"]' );
	var chosen = form.querySelector( '.hgd-subs-chosen' );

	function showError( msg ) {
		error.textContent = msg;
		error.hidden = false;
	}

	function clearError() {
		error.hidden = true;
		error.textContent = '';
	}

	// Choose a plan → reveal the details form.
	root.querySelectorAll( '.hgd-subs-choose' ).forEach( function ( btn ) {
		btn.addEventListener( 'click', function () {
			var key = btn.getAttribute( 'data-plan' );
			var card = root.querySelector( '.hgd-subs-card[data-plan="' + key + '"]' );
			planInput.value = key;
			if ( card && chosen ) {
				var name = card.querySelector( '.hgd-subs-name' );
				var price = card.querySelector( '.hgd-subs-price' );
				chosen.textContent = ( name ? name.textContent : '' ) +
					( price ? ' — ' + price.textContent.replace( /\s+/g, ' ' ).trim() : '' );
			}
			clearError();
			if ( grid ) { grid.hidden = true; }
			form.hidden = false;
			form.scrollIntoView( { behavior: 'smooth', block: 'start' } );
			var nameField = form.querySelector( 'input[name="name"]' );
			if ( nameField ) { nameField.focus(); }
		} );
	} );

	// Back to the plan grid.
	var back = form.querySelector( '.hgd-subs-back' );
	if ( back ) {
		back.addEventListener( 'click', function () {
			form.hidden = true;
			if ( grid ) { grid.hidden = false; }
			clearError();
		} );
	}

	// Submit → create checkout session → redirect to Stripe.
	form.addEventListener( 'submit', function ( e ) {
		e.preventDefault();
		clearError();

		var name = ( form.querySelector( 'input[name="name"]' ).value || '' ).trim();
		var email = ( form.querySelector( 'input[name="email"]' ).value || '' ).trim();
		if ( ! name || ! /.+@.+\..+/.test( email ) ) {
			showError( cfg.i18n.fields );
			return;
		}

		var submit = form.querySelector( '.hgd-subs-submit' );
		submit.disabled = true;
		var original = submit.textContent;
		submit.textContent = cfg.i18n.redirect;

		var payload = {
			plan_key: planInput.value,
			name: name,
			email: email,
			phone: ( form.querySelector( 'input[name="phone"]' ).value || '' ).trim(),
			postcode: ( form.querySelector( 'input[name="postcode"]' ).value || '' ).trim(),
			return_url: window.location.href.split( '#' )[0].split( '?' )[0]
		};

		fetch( cfg.rest + '/subscription/checkout', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.nonce
			},
			body: JSON.stringify( payload )
		} )
			.then( function ( r ) {
				return r.json().then( function ( body ) {
					return { ok: r.ok, body: body };
				} );
			} )
			.then( function ( res ) {
				if ( ! res.ok || ! res.body || ! res.body.redirect_url ) {
					throw new Error( ( res.body && res.body.message ) || cfg.i18n.error );
				}
				window.location.assign( res.body.redirect_url );
			} )
			.catch( function ( err ) {
				submit.disabled = false;
				submit.textContent = original;
				showError( err.message || cfg.i18n.error );
			} );
	} );
} )();

/**
 * Maintenance-plan sign-up + self-service.
 *
 * Sign-up ([hgd_maintenance_plans]): picking a plan reveals a short details
 * form; submitting posts to the checkout REST route and redirects to Stripe's
 * hosted Checkout. Self-service ([hgd_manage_plan]): emails the subscriber a
 * secure link to Stripe's Customer Portal.
 */
( function () {
	'use strict';

	var cfg = window.HGD_SUBS || {};

	function api( path, payload ) {
		return fetch( cfg.rest + path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
			body: JSON.stringify( payload )
		} ).then( function ( r ) {
			return r.json().then( function ( body ) {
				return { ok: r.ok, body: body };
			} );
		} );
	}

	// --- Sign-up flow --------------------------------------------------------
	function initCheckout() {
		var root = document.querySelector( '.hgd-subs' );
		if ( ! root || '1' !== root.getAttribute( 'data-configured' ) ) {
			return;
		}
		var grid  = root.querySelector( '.hgd-subs-grid' );
		var form  = root.querySelector( '.hgd-subs-form' );
		if ( ! form ) {
			return;
		}
		var error = form.querySelector( '.hgd-subs-error' );
		var planInput = form.querySelector( 'input[name="plan_key"]' );
		var chosen = form.querySelector( '.hgd-subs-chosen' );

		function showError( msg ) { error.textContent = msg; error.hidden = false; }
		function clearError() { error.hidden = true; error.textContent = ''; }

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

		var back = form.querySelector( '.hgd-subs-back' );
		if ( back ) {
			back.addEventListener( 'click', function () {
				form.hidden = true;
				if ( grid ) { grid.hidden = false; }
				clearError();
			} );
		}

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

			api( '/subscription/checkout', {
				plan_key: planInput.value,
				name: name,
				email: email,
				phone: ( form.querySelector( 'input[name="phone"]' ).value || '' ).trim(),
				postcode: ( form.querySelector( 'input[name="postcode"]' ).value || '' ).trim(),
				return_url: window.location.href.split( '#' )[0].split( '?' )[0]
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
	}

	// --- Self-service link request ------------------------------------------
	function initManage() {
		var form = document.querySelector( '.hgd-manage-form' );
		if ( ! form ) {
			return;
		}
		var error = form.querySelector( '.hgd-subs-error' );
		var done  = form.querySelector( '.hgd-manage-done' );

		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			error.hidden = true;

			var email = ( form.querySelector( 'input[name="email"]' ).value || '' ).trim();
			if ( ! /.+@.+\..+/.test( email ) ) {
				error.textContent = cfg.i18n.email || cfg.i18n.fields;
				error.hidden = false;
				return;
			}

			var submit = form.querySelector( '.hgd-subs-submit' );
			submit.disabled = true;
			var original = submit.textContent;
			submit.textContent = cfg.i18n.sending || '…';

			api( '/subscription/manage-link', { email: email } )
				.then( function ( res ) {
					var msg = ( res.body && res.body.message ) || '';
					done.textContent = msg;
					done.hidden = false;
					// Replace the form fields with the confirmation.
					Array.prototype.forEach.call( form.querySelectorAll( 'label, .hgd-subs-actions, .hgd-subs-blurb' ), function ( el ) {
						el.hidden = true;
					} );
				} )
				.catch( function () {
					submit.disabled = false;
					submit.textContent = original;
					error.textContent = cfg.i18n.error;
					error.hidden = false;
				} );
		} );
	}

	initCheckout();
	initManage();
} )();

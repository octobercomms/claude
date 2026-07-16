( function () {
	'use strict';

	var form = document.getElementById( 'ocad-booking-form' );
	if ( ! form ) return;

	var pkgRadios  = form.querySelectorAll( 'input[name="package_name"]' );
	var promoInput = document.getElementById( 'ocad-promo' );
	var applyBtn   = document.getElementById( 'ocad-apply-promo' );
	var submitBtn  = document.getElementById( 'ocad-submit-btn' );
	var summary    = document.getElementById( 'ocad-summary' );
	var errorDiv   = document.getElementById( 'ocad-booking-error' );
	var successDiv = document.getElementById( 'ocad-booking-success' );

	var packages    = ocadBooking.packages; // [{name,type,quantity,price}, ...]
	var currency    = ocadBooking.currency;
	var discountPct = 0;
	var validPromo  = '';

	function fmt( dollars ) {
		return new Intl.NumberFormat( 'en-US', { style: 'currency', currency: currency } ).format( dollars );
	}

	function getSelectedPackage() {
		var name = '';
		for ( var i = 0; i < pkgRadios.length; i++ ) {
			if ( pkgRadios[ i ].checked ) { name = pkgRadios[ i ].value; break; }
		}
		if ( ! name ) return null;
		for ( var j = 0; j < packages.length; j++ ) {
			if ( packages[ j ].name === name ) return packages[ j ];
		}
		return null;
	}

	function updateSummary() {
		var pkg = getSelectedPackage();
		if ( ! pkg ) {
			summary.style.display = 'none';
			submitBtn.disabled = true;
			return;
		}

		var subtotal = pkg.price;
		var discount = Math.round( subtotal * discountPct / 100 );
		var total    = subtotal - discount;

		document.getElementById( 'ocad-sum-package' ).textContent = pkg.name;

		var promoRow = document.getElementById( 'ocad-sum-promo-row' );
		if ( discountPct > 0 ) {
			promoRow.style.display = '';
			document.getElementById( 'ocad-sum-discount' ).textContent = '−' + discountPct + '% (−' + fmt( discount ) + ')';
		} else {
			promoRow.style.display = 'none';
		}

		document.getElementById( 'ocad-sum-total' ).textContent = fmt( total );
		submitBtn.textContent = 'Pay ' + fmt( total );
		submitBtn.disabled = false;
		summary.style.display = '';
	}

	for ( var p = 0; p < pkgRadios.length; p++ ) {
		pkgRadios[ p ].addEventListener( 'change', function () {
			var rows = form.querySelectorAll( '.ocad-package-row' );
			for ( var r = 0; r < rows.length; r++ ) {
				rows[ r ].classList.toggle( 'ocad-package-row--selected', rows[ r ].contains( this ) );
			}
			updateSummary();
		} );
	}

	// Promo code
	applyBtn.addEventListener( 'click', function () {
		var code = promoInput.value.trim();
		var msg  = document.getElementById( 'ocad-promo-msg' );
		if ( ! code ) {
			msg.textContent = 'Enter a promo code first.';
			msg.style.color = '#b91c1c';
			return;
		}
		applyBtn.disabled    = true;
		applyBtn.textContent = 'Checking…';
		fetch( ocadBooking.promoUrl + '?code=' + encodeURIComponent( code ), { credentials: 'omit' } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( data ) {
				if ( data.valid ) {
					discountPct = data.discount;
					validPromo  = code;
					msg.textContent = '✓ ' + data.discount + '% discount applied!';
					msg.style.color = '#16a34a';
				} else {
					discountPct = 0;
					validPromo  = '';
					msg.textContent = 'Invalid promo code.';
					msg.style.color = '#b91c1c';
				}
				updateSummary();
			} )
			.catch( function () {
				msg.textContent = 'Error checking code. Please try again.';
				msg.style.color = '#b91c1c';
			} )
			.finally( function () {
				applyBtn.disabled    = false;
				applyBtn.textContent = 'Apply';
			} );
	} );

	// Stripe Card Element
	var stripe      = null;
	var cardElement = null;

	if ( ocadBooking.stripeKey ) {
		stripe  = Stripe( ocadBooking.stripeKey );
		var elements = stripe.elements();
		cardElement  = elements.create( 'card', {
			style: {
				base: {
					fontSize:    '15px',
					fontFamily:  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					color:       '#1a202c',
					'::placeholder': { color: '#94a3b8' },
				},
				invalid: { color: '#dc2626' },
			},
			hidePostalCode: true,
		} );
		cardElement.mount( '#ocad-card-element' );

		cardElement.on( 'change', function ( event ) {
			var errDiv = document.getElementById( 'ocad-card-errors' );
			errDiv.textContent = event.error ? event.error.message : '';
		} );
	}

	// Form submit
	form.addEventListener( 'submit', function ( e ) {
		e.preventDefault();

		if ( ! stripe || ! cardElement ) {
			errorDiv.textContent   = 'Stripe not initialised. Please refresh and try again.';
			errorDiv.style.display = '';
			return;
		}

		var originalText = submitBtn.textContent;
		submitBtn.disabled    = true;
		submitBtn.textContent = 'Processing…';
		errorDiv.style.display = 'none';

		var fd = new FormData( form );
		if ( validPromo ) fd.set( 'promo_code', validPromo );

		// Step 1: create booking + PaymentIntent on server
		fetch( ocadBooking.restUrl, {
			method:      'POST',
			credentials: 'include',
			headers:     { 'X-WP-Nonce': ocadBooking.nonce },
			body:        fd,
		} )
			.then( function ( r ) { return r.json(); } )
			.then( function ( data ) {
				if ( ! data.client_secret ) {
					throw new Error( data.message || 'Booking failed. Please try again.' );
				}

				// Step 2: confirm card payment
				return stripe.confirmCardPayment( data.client_secret, {
					payment_method: {
						card: cardElement,
						billing_details: {
							name:  form.querySelector( '[name="campaign_name"]' ).value,
							email: form.querySelector( '[name="email"]' ).value,
						},
					},
				} );
			} )
			.then( function ( result ) {
				if ( result.error ) {
					throw new Error( result.error.message );
				}
				// Success
				form.style.display         = 'none';
				successDiv.style.display   = '';
				successDiv.scrollIntoView( { behavior: 'smooth', block: 'start' } );
			} )
			.catch( function ( err ) {
				errorDiv.textContent   = err.message;
				errorDiv.style.display = '';
				submitBtn.disabled     = false;
				submitBtn.textContent  = originalText;
			} );
	} );
} )();

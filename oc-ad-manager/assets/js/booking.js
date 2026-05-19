( function () {
	'use strict';

	var form = document.getElementById( 'ocad-booking-form' );
	if ( ! form ) return;

	var formatSel  = document.getElementById( 'ocad-format' );
	var weeksSel   = document.getElementById( 'ocad-weeks' );
	var promoInput = document.getElementById( 'ocad-promo' );
	var applyBtn   = document.getElementById( 'ocad-apply-promo' );
	var submitBtn  = document.getElementById( 'ocad-submit-btn' );
	var summary    = document.getElementById( 'ocad-summary' );
	var errorDiv   = document.getElementById( 'ocad-booking-error' );

	var prices      = ocadBooking.prices;
	var currency    = ocadBooking.currency;
	var discountPct = 0;
	var validPromo  = '';

	function fmt( dollars ) {
		return new Intl.NumberFormat( 'en-US', { style: 'currency', currency: currency } ).format( dollars );
	}

	function updateSummary() {
		var format = formatSel.value;
		var weeks  = parseInt( weeksSel.value, 10 );

		if ( ! format || ! weeks ) {
			summary.style.display = 'none';
			submitBtn.disabled = true;
			return;
		}

		var ppw      = prices[ format ] || 0;
		var subtotal = ppw * weeks;
		var discount = Math.round( subtotal * discountPct / 100 );
		var total    = subtotal - discount;

		var fmtLabels = { mpu: 'MPU', leaderboard: 'Leaderboard', skyscraper: 'Skyscraper' };
		document.getElementById( 'ocad-sum-format' ).textContent   = ( fmtLabels[ format ] || format ) + ' — ' + fmt( ppw ) + '/wk';
		document.getElementById( 'ocad-sum-duration' ).textContent = weeks + ( weeks === 1 ? ' week' : ' weeks' );

		var promoRow = document.getElementById( 'ocad-sum-promo-row' );
		if ( discountPct > 0 ) {
			promoRow.style.display = '';
			document.getElementById( 'ocad-sum-discount' ).textContent = '−' + discountPct + '% (−' + fmt( discount ) + ')';
		} else {
			promoRow.style.display = 'none';
		}

		document.getElementById( 'ocad-sum-total' ).textContent = fmt( total );
		submitBtn.textContent = 'Continue to Payment — ' + fmt( total );
		submitBtn.disabled = false;
		summary.style.display = '';
	}

	formatSel.addEventListener( 'change', updateSummary );
	weeksSel.addEventListener( 'change', updateSummary );

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

	form.addEventListener( 'submit', function ( e ) {
		e.preventDefault();

		var originalText = submitBtn.textContent;
		submitBtn.disabled    = true;
		submitBtn.textContent = 'Processing…';
		errorDiv.style.display = 'none';

		var fd = new FormData( form );
		if ( validPromo ) {
			fd.set( 'promo_code', validPromo );
		}

		fetch( ocadBooking.restUrl, {
			method:      'POST',
			credentials: 'include',
			headers:     { 'X-WP-Nonce': ocadBooking.nonce },
			body:        fd,
		} )
			.then( function ( r ) { return r.json(); } )
			.then( function ( data ) {
				if ( data.session_url ) {
					window.location.href = data.session_url;
				} else {
					throw new Error( data.message || 'Booking failed. Please try again.' );
				}
			} )
			.catch( function ( err ) {
				errorDiv.textContent   = err.message;
				errorDiv.style.display = '';
				submitBtn.disabled     = false;
				submitBtn.textContent  = originalText;
			} );
	} );
} )();

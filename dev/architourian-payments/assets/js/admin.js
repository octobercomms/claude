/* Architourian Payment Links — admin interactions: copy-to-clipboard + QR modal. */
( function () {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', function () {
		bindCopy();
		bindQr();
	} );

	/* Copy a payment link to the clipboard, with a graceful fallback. */
	function bindCopy() {
		document.querySelectorAll( '.arpl-copy' ).forEach( function ( btn ) {
			btn.addEventListener( 'click', function () {
				var url = btn.getAttribute( 'data-url' );
				if ( ! url ) {
					return;
				}
				copyText( url ).then( function () {
					flash( btn, 'Copied!' );
				} ).catch( function () {
					window.prompt( 'Copy this payment link:', url );
				} );
			} );
		} );
	}

	function copyText( text ) {
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			return navigator.clipboard.writeText( text );
		}
		return new Promise( function ( resolve, reject ) {
			try {
				var ta = document.createElement( 'textarea' );
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild( ta );
				ta.select();
				var ok = document.execCommand( 'copy' );
				document.body.removeChild( ta );
				ok ? resolve() : reject();
			} catch ( e ) {
				reject( e );
			}
		} );
	}

	function flash( btn, text ) {
		var original = btn.textContent;
		btn.textContent = text;
		btn.classList.add( 'arpl-copied' );
		setTimeout( function () {
			btn.textContent = original;
			btn.classList.remove( 'arpl-copied' );
		}, 1500 );
	}

	/* QR modal. */
	function bindQr() {
		var modal = document.getElementById( 'arpl-qr-modal' );
		if ( ! modal ) {
			return;
		}
		var canvas = document.getElementById( 'arpl-qr-canvas' );
		var title = document.getElementById( 'arpl-qr-title' );
		var urlEl = document.getElementById( 'arpl-qr-url' );

		function open( url, label ) {
			canvas.innerHTML = '';
			if ( typeof QRCode !== 'undefined' ) {
				new QRCode( canvas, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M } );
			} else {
				canvas.textContent = 'QR library failed to load.';
			}
			title.textContent = label ? ( 'Scan to pay — ' + label ) : 'Scan to pay';
			urlEl.textContent = url;
			modal.setAttribute( 'aria-hidden', 'false' );
			modal.classList.add( 'is-open' );
		}

		function close() {
			modal.setAttribute( 'aria-hidden', 'true' );
			modal.classList.remove( 'is-open' );
			canvas.innerHTML = '';
		}

		document.querySelectorAll( '.arpl-qr' ).forEach( function ( btn ) {
			btn.addEventListener( 'click', function () {
				open( btn.getAttribute( 'data-url' ), btn.getAttribute( 'data-label' ) );
			} );
		} );

		modal.querySelector( '.arpl-modal-close' ).addEventListener( 'click', close );
		modal.querySelector( '.arpl-modal-backdrop' ).addEventListener( 'click', close );
		document.addEventListener( 'keyup', function ( e ) {
			if ( 'Escape' === e.key ) {
				close();
			}
		} );
	}
} )();

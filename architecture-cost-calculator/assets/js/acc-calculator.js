/* global accData */
( function () {
	'use strict';

	var data = window.accData || {};

	function roundToNearest( value, nearest ) {
		return Math.round( value / nearest ) * nearest;
	}

	function formatCurrency( value ) {
		var symbol = data.currency || '£';
		return symbol + value.toLocaleString( 'en-GB' );
	}

	function calculate() {
		var projectType = document.getElementById( 'acc-project-type' ).value;
		var floorArea   = parseFloat( document.getElementById( 'acc-floor-area' ).value );
		var specLevel   = document.getElementById( 'acc-spec-level' ).value;
		var resultsEl   = document.getElementById( 'acc-results' );

		if ( ! projectType || isNaN( floorArea ) || floorArea < 10 || floorArea > 1000 ) {
			resultsEl.hidden = true;
			return;
		}

		var costRates    = data.costRates  || {};
		var typeRates    = costRates[ projectType ];
		var costPerSqm   = typeRates ? typeRates[ specLevel ] : null;

		if ( ! costPerSqm ) {
			resultsEl.hidden = true;
			return;
		}

		var buildMid  = floorArea * costPerSqm;
		var buildLow  = roundToNearest( buildMid * 0.9, 1000 );
		var buildHigh = roundToNearest( buildMid * 1.1, 1000 );

		document.getElementById( 'acc-build-cost' ).textContent =
			formatCurrency( buildLow ) + ' – ' + formatCurrency( buildHigh );

		var feesBlock = document.getElementById( 'acc-fees-block' );

		if ( data.showFees === '1' ) {
			var feeRates  = data.feeRates || {};
			var feePct    = ( parseFloat( feeRates[ projectType ] ) || 12 ) / 100;
			var feeLow    = roundToNearest( buildMid * feePct * 0.9, 100 );
			var feeHigh   = roundToNearest( buildMid * feePct * 1.1, 100 );

			document.getElementById( 'acc-fees' ).textContent =
				formatCurrency( feeLow ) + ' – ' + formatCurrency( feeHigh );

			feesBlock.hidden = false;
		} else {
			feesBlock.hidden = true;
		}

		var ctaWrap = document.getElementById( 'acc-cta-wrap' );
		ctaWrap.innerHTML = '';

		if ( data.ctaUrl ) {
			var btn       = document.createElement( 'a' );
			btn.href      = data.ctaUrl;
			btn.className = 'acc-cta-button';
			btn.textContent = data.ctaLabel || 'Get in touch';
			ctaWrap.appendChild( btn );
		}

		resultsEl.hidden = false;
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		var projectTypeEl = document.getElementById( 'acc-project-type' );
		var floorAreaEl   = document.getElementById( 'acc-floor-area' );
		var specLevelEl   = document.getElementById( 'acc-spec-level' );

		if ( ! projectTypeEl || ! floorAreaEl || ! specLevelEl ) {
			return;
		}

		projectTypeEl.addEventListener( 'change', calculate );
		floorAreaEl.addEventListener( 'input',  calculate );
		specLevelEl.addEventListener( 'change', calculate );
	} );
}() );

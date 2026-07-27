/**
 * Popup Settings meta box: show only the fields relevant to the chosen
 * trigger / frequency / targeting option.
 */
( function () {
	'use strict';

	function byId( id ) {
		return document.getElementById( id );
	}

	function toggleTrigger() {
		var type = byId( 'ocpop_trigger_type' ).value;
		var rows = document.querySelectorAll( '.ocpop-when' );
		rows.forEach( function ( row ) {
			row.style.display = row.classList.contains( 'ocpop-when-' + type ) ? '' : 'none';
		} );
		// Per-trigger help notes inside the shared row.
		[ 'exit', 'load', 'manual' ].forEach( function ( t ) {
			var note = document.querySelector( '.ocpop-note-' + t );
			if ( note ) {
				note.style.display = ( type === t ) ? '' : 'none';
			}
		} );
	}

	function toggleFreq() {
		var val = byId( 'ocpop_frequency' ).value;
		document.querySelectorAll( '.ocpop-freq-days' ).forEach( function ( row ) {
			row.style.display = ( val === 'days' ) ? '' : 'none';
		} );
	}

	function toggleTarget() {
		var val = byId( 'ocpop_display_on' ).value;
		var row = document.querySelector( '.ocpop-target-ids' );
		if ( row ) {
			row.style.display = ( val === 'selected' || val === 'exclude' ) ? '' : 'none';
		}
	}

	/* --- Content mode: template vs page builder ------------------------- */

	function currentMode() {
		var checked = document.querySelector( '.ocpop-mode:checked' );
		return checked ? checked.value : 'template';
	}

	function toggleMode() {
		var mode = currentMode();
		var fields = document.querySelector( '.ocpop-tpl-fields' );
		var note = document.querySelector( '.ocpop-mode-builder-note' );
		if ( fields ) {
			fields.style.display = ( mode === 'template' ) ? '' : 'none';
		}
		if ( note ) {
			note.style.display = ( mode === 'builder' ) ? '' : 'none';
		}
		if ( mode === 'template' ) {
			toggleLayout();
		}
	}

	function toggleLayout() {
		var sel = byId( 'ocpop_tpl_layout' );
		var row = document.querySelector( '.ocpop-tpl-image-row' );
		if ( sel && row ) {
			row.style.display = ( sel.value === 'text-only' ) ? 'none' : '';
		}
	}

	/* --- Media picker for the template image ---------------------------- */

	function wireMediaPicker() {
		var selectBtn = document.querySelector( '.ocpop-img-select' );
		var removeBtn = document.querySelector( '.ocpop-img-remove' );
		var input = byId( 'ocpop_tpl_image_id' );
		var preview = byId( 'ocpop_tpl_image_preview' );
		if ( ! selectBtn || ! input || ! window.wp || ! window.wp.media ) {
			return;
		}
		var frame;
		selectBtn.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			if ( frame ) {
				frame.open();
				return;
			}
			frame = window.wp.media( {
				title: 'Select popup image',
				button: { text: 'Use this image' },
				multiple: false
			} );
			frame.on( 'select', function () {
				var att = frame.state().get( 'selection' ).first().toJSON();
				input.value = att.id;
				var url = ( att.sizes && att.sizes.medium ) ? att.sizes.medium.url : att.url;
				preview.innerHTML = '<img src="' + url + '" alt="">';
				if ( removeBtn ) {
					removeBtn.style.display = '';
				}
			} );
			frame.open();
		} );
		if ( removeBtn ) {
			removeBtn.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				input.value = '';
				preview.innerHTML = '';
				removeBtn.style.display = 'none';
			} );
		}
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		// Content mode + template controls.
		var modeRadios = document.querySelectorAll( '.ocpop-mode' );
		if ( modeRadios.length ) {
			modeRadios.forEach( function ( r ) {
				r.addEventListener( 'change', toggleMode );
			} );
			var layoutSel = byId( 'ocpop_tpl_layout' );
			if ( layoutSel ) {
				layoutSel.addEventListener( 'change', toggleLayout );
			}
			wireMediaPicker();
			toggleMode();
		}

		if ( ! byId( 'ocpop_trigger_type' ) ) {
			return;
		}
		byId( 'ocpop_trigger_type' ).addEventListener( 'change', toggleTrigger );
		byId( 'ocpop_frequency' ).addEventListener( 'change', toggleFreq );
		byId( 'ocpop_display_on' ).addEventListener( 'change', toggleTarget );
		toggleTrigger();
		toggleFreq();
		toggleTarget();
	} );
} )();

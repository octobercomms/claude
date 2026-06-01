/* Hillcroft Garden Designer — admin helpers. Kept tiny for the foundation build. */
( function () {
	'use strict';

	// Live-sync the deposit/commencement/completion percentages so they total 100.
	document.addEventListener( 'DOMContentLoaded', function () {
		var fields = [ 'deposit_pct', 'commencement_pct', 'completion_pct' ]
			.map( function ( n ) { return document.querySelector( '[name="' + n + '"]' ); } )
			.filter( Boolean );

		if ( fields.length === 3 ) {
			var note = document.createElement( 'p' );
			note.className = 'hgd-muted';
			var render = function () {
				var total = fields.reduce( function ( sum, f ) { return sum + ( parseFloat( f.value ) || 0 ); }, 0 );
				note.textContent = 'Milestone split totals ' + total + '%' + ( total === 100 ? ' ✓' : ' — should total 100%' );
				note.style.color = total === 100 ? '' : '#9b2c2c';
			};
			fields.forEach( function ( f ) { f.addEventListener( 'input', render ); } );
			fields[ 2 ].closest( '.hgd-grid' ).after( note );
			render();
		}
	} );
}() );

/* Image lightbox — click any render/asset thumbnail to view it full size. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var links = document.querySelectorAll( 'a[data-hgd-lightbox]' );
		if ( ! links.length ) { return; }

		var overlay = document.createElement( 'div' );
		overlay.className = 'hgd-lightbox';
		overlay.innerHTML = '<button type="button" class="hgd-lightbox-close" aria-label="Close">×</button><img alt="" />';
		document.body.appendChild( overlay );
		var img = overlay.querySelector( 'img' );

		function open( src ) {
			if ( ! src ) { return; }
			img.src = src;
			overlay.classList.add( 'is-open' );
			document.body.style.overflow = 'hidden';
		}
		function close() {
			overlay.classList.remove( 'is-open' );
			img.src = '';
			document.body.style.overflow = '';
		}

		links.forEach( function ( a ) {
			a.addEventListener( 'click', function ( e ) {
				if ( a.getAttribute( 'href' ) ) { e.preventDefault(); open( a.getAttribute( 'href' ) ); }
			} );
		} );
		overlay.addEventListener( 'click', function ( e ) {
			if ( e.target === overlay || e.target.classList.contains( 'hgd-lightbox-close' ) ) { close(); }
		} );
		document.addEventListener( 'keydown', function ( e ) {
			if ( 'Escape' === e.key && overlay.classList.contains( 'is-open' ) ) { close(); }
		} );
	} );
}() );

/* Loading overlay for slow actions (Claude / Gemini can take ~60s). On submit
   of a known long-running form, lock the page with a branded spinner + message
   until it finishes (the action redirects + reloads the page on completion). */
( function () {
	'use strict';

	// action value -> message shown while it runs.
	var MESSAGES = {
		hgd_claude_read:     'Claude is reading your sketch and photos…',
		hgd_chat_send:       'Claude is thinking and updating your brief…',
		hgd_compose_prompt:  'Claude is composing the design brief…',
		hgd_generate_render: 'Generating your concept render… this can take up to a minute.',
		hgd_generate_plan:   'Generating your garden plan… this can take up to a minute.',
		hgd_compose_plan_prompt: 'Claude is drafting the plan…',
		hgd_pack_generate_view:  'Generating this view… this can take up to a minute.',
		hgd_pack_generate_all:   'Generating the full render pack… this can take a couple of minutes. Please keep this tab open.',
		hgd_pack_seasonal:       'Generating the seasonal views… this can take a minute or two.',
		hgd_pack_fetch_satellite:'Fetching the satellite view…',
		hgd_upload_assets:   'Uploading your images…',
		hgd_plants_import:   'Importing plants…',
		hgd_proposal_send:   'Sending the proposal…'
	};

	function buildOverlay() {
		var o = document.createElement( 'div' );
		o.className = 'hgd-loading';
		o.setAttribute( 'role', 'alert' );
		o.setAttribute( 'aria-live', 'assertive' );
		o.innerHTML = '<div class="hgd-loading-box">' +
			'<div class="hgd-spinner" aria-hidden="true"></div>' +
			'<p class="hgd-loading-msg"></p>' +
			'<p class="hgd-loading-sub">Please don’t close or refresh this page.</p>' +
			'</div>';
		return o;
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		var overlay = null;

		document.addEventListener( 'submit', function ( e ) {
			var form = e.target;
			if ( ! form || form.nodeName !== 'FORM' ) { return; }
			var actionField = form.querySelector( 'input[name="action"]' );
			if ( ! actionField ) { return; }
			var msg = MESSAGES[ actionField.value ];
			if ( ! msg ) { return; }

			if ( ! overlay ) { overlay = buildOverlay(); document.body.appendChild( overlay ); }
			overlay.querySelector( '.hgd-loading-msg' ).textContent = msg;
			overlay.classList.add( 'is-open' );
			document.body.style.overflow = 'hidden';

			// Disable the submit button to prevent double-clicks (after a tick so
			// the value still posts).
			var btn = form.querySelector( 'button[type="submit"], input[type="submit"]' );
			if ( btn ) { setTimeout( function () { btn.setAttribute( 'disabled', 'disabled' ); }, 10 ); }
		}, true );

		// If the user navigates back to a cached page, make sure the overlay is gone.
		window.addEventListener( 'pageshow', function () {
			if ( overlay ) { overlay.classList.remove( 'is-open' ); document.body.style.overflow = ''; }
		} );
	} );
}() );

/* Plant catalogue — Import CSV picker auto-submit. The visible "Import CSV" pill
   is a <label> for a hidden file input; selecting a file submits the form. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var input = document.querySelector( '[data-hgd-csv-auto]' );
		if ( ! input ) { return; }
		input.addEventListener( 'change', function () {
			if ( input.files && input.files.length && input.form ) {
				input.form.submit();
			}
		} );
	} );
}() );

/* Plant catalogue — click-to-expand rows. Clicking a plant row (or pressing Enter)
   toggles the detail row immediately below it. Clicks on the Edit/Delete/fetch
   controls are ignored so they keep their own behaviour. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var rows = document.querySelectorAll( '.hgd-plant-row' );
		if ( ! rows.length ) { return; }

		function toggle( row ) {
			var detail = row.nextElementSibling;
			if ( ! detail || ! detail.classList.contains( 'hgd-plant-detail' ) ) { return; }
			var open = detail.classList.toggle( 'is-open' );
			row.classList.toggle( 'is-open', open );
			row.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		}

		rows.forEach( function ( row ) {
			row.addEventListener( 'click', function ( e ) {
				if ( e.target.closest( '[data-hgd-no-expand]' ) ) { return; }
				toggle( row );
			} );
			row.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' ) {
					if ( e.target.closest( '[data-hgd-no-expand]' ) ) { return; }
					e.preventDefault();
					toggle( row );
				}
			} );
		} );
	} );
}() );

/* Plant edit — media-library image picker. Opens wp.media, sets the hidden
   image_id input + preview; Remove clears it. */
( function () {
	'use strict';
	document.addEventListener( 'DOMContentLoaded', function () {
		var pick    = document.getElementById( 'hgd-image-pick' );
		var idField = document.getElementById( 'hgd-image-id' );
		var preview = document.getElementById( 'hgd-image-preview' );
		var remove  = document.getElementById( 'hgd-image-remove' );
		if ( ! pick || ! idField || ! preview ) { return; }
		if ( typeof window.wp === 'undefined' || ! window.wp.media ) { return; }

		var frame = null;

		function setPreview( html ) {
			preview.innerHTML = html;
		}

		pick.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			if ( ! frame ) {
				frame = window.wp.media( {
					title: 'Select a plant photo',
					button: { text: 'Use this photo' },
					library: { type: 'image' },
					multiple: false
				} );
				frame.on( 'select', function () {
					var att = frame.state().get( 'selection' ).first().toJSON();
					idField.value = att.id;
					var src = att.sizes && att.sizes.thumbnail ? att.sizes.thumbnail.url : att.url;
					setPreview( '<img src="' + src + '" alt="" />' );
					if ( remove ) { remove.classList.remove( 'hgd-hidden' ); }
				} );
			}
			frame.open();
		} );

		if ( remove ) {
			remove.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				idField.value = '0';
				setPreview( '<span class="hgd-plant-thumb hgd-plant-thumb-empty" aria-hidden="true">✿</span>' );
				remove.classList.add( 'hgd-hidden' );
			} );
		}
	} );
}() );

/* Measurements & site plan — structured zone table with live areas + a
   dependency-free draw-on-plan canvas (scale calibration + rectangle zones).
   Only runs when the measure panel is present on the page. */
( function () {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', function () {
		var root = document.querySelector( '[data-hgd-measure]' );
		if ( ! root ) { return; }

		var ZONE_TYPES = [ 'lawn', 'border', 'patio', 'path', 'water', 'structure', 'other' ];

		var form     = root.querySelector( '[data-hgd-measure-form]' );
		var tbody    = root.querySelector( '[data-hgd-zone-rows]' );
		var addBtn   = root.querySelector( '[data-hgd-zone-add]' );
		var jsonInp  = root.querySelector( '[data-hgd-measure-json]' );
		var plotWInp = root.querySelector( '[data-hgd-plot-w]' );
		var plotLInp = root.querySelector( '[data-hgd-plot-l]' );
		var sumPlot  = root.querySelector( '[data-hgd-sum-plot]' );
		var sumZones = root.querySelector( '[data-hgd-sum-zones]' );
		var warn     = root.querySelector( '[data-hgd-warn]' );

		var pxPerM = 0;

		function num( v ) { var f = parseFloat( v ); return ( isNaN( f ) || f < 0 ) ? 0 : f; }
		function fmt( f ) { return ( Math.round( f * 100 ) / 100 ).toFixed( 2 ); }

		// --- Manual table: live areas + add/remove rows ----------------------

		function recalcRow( row ) {
			var w = num( row.querySelector( '[data-hgd-z-w]' ).value );
			var l = num( row.querySelector( '[data-hgd-z-l]' ).value );
			var areaInp = row.querySelector( '[data-hgd-z-area]' );
			if ( w > 0 && l > 0 ) {
				areaInp.value = fmt( w * l );
				areaInp.setAttribute( 'readonly', 'readonly' );
			} else {
				areaInp.removeAttribute( 'readonly' );
			}
		}

		function rowArea( row ) {
			return num( row.querySelector( '[data-hgd-z-area]' ).value );
		}

		function recalcAll() {
			var plotW = num( plotWInp.value );
			var plotL = num( plotLInp.value );
			var plotArea = plotW * plotL;
			var total = 0;
			tbody.querySelectorAll( '[data-hgd-zone-row]' ).forEach( function ( row ) {
				recalcRow( row );
				total += rowArea( row );
			} );
			if ( sumPlot ) { sumPlot.textContent = plotArea > 0 ? fmt( plotArea ) + ' m²' : '—'; }
			if ( sumZones ) { sumZones.textContent = fmt( total ); }
			if ( warn ) { warn.classList.toggle( 'hgd-hidden', ! ( plotArea > 0 && total > plotArea * 1.05 ) ); }
		}

		function makeRow( data ) {
			data = data || {};
			var tr = document.createElement( 'tr' );
			tr.setAttribute( 'data-hgd-zone-row', '' );
			var opts = ZONE_TYPES.map( function ( t ) {
				var sel = ( ( data.type || 'lawn' ) === t ) ? ' selected' : '';
				return '<option value="' + t + '"' + sel + '>' + t.charAt( 0 ).toUpperCase() + t.slice( 1 ) + '</option>';
			} ).join( '' );
			tr.innerHTML =
				'<td><input type="text" name="zone_label[]" data-hgd-z-label /></td>' +
				'<td><select name="zone_type[]" data-hgd-z-type>' + opts + '</select></td>' +
				'<td><input type="number" step="0.01" min="0" name="zone_w[]" data-hgd-z-w /></td>' +
				'<td><input type="number" step="0.01" min="0" name="zone_l[]" data-hgd-z-l /></td>' +
				'<td><input type="number" step="0.01" min="0" name="zone_area[]" data-hgd-z-area /></td>' +
				'<td><button type="button" class="hgd-measure-del" data-hgd-zone-del aria-label="Remove zone">×</button></td>';
			if ( data.label ) { tr.querySelector( '[data-hgd-z-label]' ).value = data.label; }
			if ( data.w ) { tr.querySelector( '[data-hgd-z-w]' ).value = data.w; }
			if ( data.l ) { tr.querySelector( '[data-hgd-z-l]' ).value = data.l; }
			if ( data.area_m2 ) { tr.querySelector( '[data-hgd-z-area]' ).value = data.area_m2; }
			if ( data.rect ) { tr._hgdRect = data.rect; }
			return tr;
		}

		if ( addBtn ) {
			addBtn.addEventListener( 'click', function () {
				tbody.appendChild( makeRow() );
				recalcAll();
			} );
		}

		tbody.addEventListener( 'click', function ( e ) {
			var del = e.target.closest( '[data-hgd-zone-del]' );
			if ( ! del ) { return; }
			var rows = tbody.querySelectorAll( '[data-hgd-zone-row]' );
			if ( rows.length <= 1 ) {
				// Keep one empty row rather than removing the last.
				var row = del.closest( '[data-hgd-zone-row]' );
				row.querySelectorAll( 'input' ).forEach( function ( i ) { i.value = ''; } );
				row._hgdRect = null;
			} else {
				del.closest( '[data-hgd-zone-row]' ).remove();
			}
			recalcAll();
		} );

		root.addEventListener( 'input', function ( e ) {
			if ( e.target.matches( '[data-hgd-z-w], [data-hgd-z-l], [data-hgd-z-area], [data-hgd-plot-w], [data-hgd-plot-l]' ) ) {
				recalcAll();
			}
		} );

		// --- Serialise to the hidden JSON field on submit --------------------

		function collect() {
			var zones = [];
			tbody.querySelectorAll( '[data-hgd-zone-row]' ).forEach( function ( row ) {
				var label = row.querySelector( '[data-hgd-z-label]' ).value.trim();
				var w = num( row.querySelector( '[data-hgd-z-w]' ).value );
				var l = num( row.querySelector( '[data-hgd-z-l]' ).value );
				var area = num( row.querySelector( '[data-hgd-z-area]' ).value );
				if ( ! label && ! w && ! l && ! area ) { return; }
				var z = {
					label: label,
					type: row.querySelector( '[data-hgd-z-type]' ).value,
					w: w, l: l, area_m2: ( w > 0 && l > 0 ) ? Math.round( w * l * 100 ) / 100 : area
				};
				if ( row._hgdRect ) { z.rect = row._hgdRect; }
				zones.push( z );
			} );
			var noteInp = root.querySelector( '[name="scale_note"]' );
			return {
				unit: 'm',
				plot: { w: num( plotWInp.value ), l: num( plotLInp.value ) },
				scale_note: noteInp ? noteInp.value : '',
				scale: { px_per_m: pxPerM || 0 },
				zones: zones
			};
		}

		if ( form ) {
			form.addEventListener( 'submit', function () {
				jsonInp.value = JSON.stringify( collect() );
			} );
		}

		// --- Draw-on-plan canvas (progressive enhancement) -------------------

		var canvas = root.querySelector( '[data-hgd-canvas]' );
		var wrap   = root.querySelector( '[data-hgd-canvas-wrap]' );
		var toggle = root.querySelector( '[data-hgd-canvas-toggle]' );
		var status = root.querySelector( '[data-hgd-canvas-status]' );
		var bg     = null;

		// Seed pxPerM + any saved rects from the JSON the server printed.
		( function seed() {
			var seedEl = root.querySelector( '[data-hgd-measure-seed]' );
			if ( ! seedEl ) { return; }
			try {
				var data = JSON.parse( seedEl.textContent || '{}' );
				if ( data && data.scale && data.scale.px_per_m ) { pxPerM = parseFloat( data.scale.px_per_m ) || 0; }
				if ( data && data.zones ) {
					var rows = tbody.querySelectorAll( '[data-hgd-zone-row]' );
					data.zones.forEach( function ( z, i ) {
						if ( z.rect && rows[ i ] ) { rows[ i ]._hgdRect = z.rect; }
					} );
				}
			} catch ( err ) {}
		}() );

		if ( ! canvas || ! canvas.getContext ) { recalcAll(); return; }

		var ctx  = canvas.getContext( '2d' );
		var tool = 'zone';
		var dragging = false;
		var start = null, cur = null;
		var scaleLine = null; // {x1,y1,x2,y2}

		function setStatus( msg ) { if ( status ) { status.textContent = msg; } }

		function drawGrid() {
			ctx.clearRect( 0, 0, canvas.width, canvas.height );
			if ( bg ) {
				ctx.drawImage( bg, 0, 0, canvas.width, canvas.height );
			} else {
				ctx.fillStyle = '#f6f5ef';
				ctx.fillRect( 0, 0, canvas.width, canvas.height );
				ctx.strokeStyle = '#e0ddd0';
				ctx.lineWidth = 1;
				for ( var x = 0; x <= canvas.width; x += 32 ) {
					ctx.beginPath(); ctx.moveTo( x, 0 ); ctx.lineTo( x, canvas.height ); ctx.stroke();
				}
				for ( var y = 0; y <= canvas.height; y += 32 ) {
					ctx.beginPath(); ctx.moveTo( 0, y ); ctx.lineTo( canvas.width, y ); ctx.stroke();
				}
			}
		}

		function metres( px ) { return pxPerM > 0 ? px / pxPerM : 0; }

		function redraw() {
			drawGrid();
			// Saved zone rectangles.
			tbody.querySelectorAll( '[data-hgd-zone-row]' ).forEach( function ( row ) {
				var r = row._hgdRect;
				if ( ! r ) { return; }
				ctx.strokeStyle = 'rgba(106,123,74,0.95)';
				ctx.fillStyle = 'rgba(106,123,74,0.18)';
				ctx.lineWidth = 2;
				ctx.fillRect( r.x, r.y, r.w, r.h );
				ctx.strokeRect( r.x, r.y, r.w, r.h );
				var label = row.querySelector( '[data-hgd-z-label]' ).value || 'Zone';
				ctx.fillStyle = '#33352c';
				ctx.font = '13px sans-serif';
				ctx.fillText( label, r.x + 4, r.y + 16 );
			} );
			// Scale line.
			if ( scaleLine ) {
				ctx.strokeStyle = '#b8742a';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo( scaleLine.x1, scaleLine.y1 );
				ctx.lineTo( scaleLine.x2, scaleLine.y2 );
				ctx.stroke();
			}
			// In-progress shape.
			if ( dragging && start && cur ) {
				if ( tool === 'scale' ) {
					ctx.strokeStyle = '#b8742a';
					ctx.lineWidth = 3;
					ctx.beginPath();
					ctx.moveTo( start.x, start.y );
					ctx.lineTo( cur.x, cur.y );
					ctx.stroke();
				} else {
					ctx.strokeStyle = 'rgba(106,123,74,0.95)';
					ctx.fillStyle = 'rgba(106,123,74,0.12)';
					ctx.lineWidth = 2;
					ctx.fillRect( start.x, start.y, cur.x - start.x, cur.y - start.y );
					ctx.strokeRect( start.x, start.y, cur.x - start.x, cur.y - start.y );
				}
			}
		}

		function pos( e ) {
			var rect = canvas.getBoundingClientRect();
			return {
				x: ( e.clientX - rect.left ) * ( canvas.width / rect.width ),
				y: ( e.clientY - rect.top ) * ( canvas.height / rect.height )
			};
		}

		canvas.addEventListener( 'mousedown', function ( e ) {
			dragging = true; start = pos( e ); cur = start;
		} );
		canvas.addEventListener( 'mousemove', function ( e ) {
			if ( ! dragging ) { return; }
			cur = pos( e ); redraw();
		} );
		window.addEventListener( 'mouseup', function () {
			if ( ! dragging ) { return; }
			dragging = false;
			if ( ! start || ! cur ) { return; }

			if ( tool === 'scale' ) {
				var dx = cur.x - start.x, dy = cur.y - start.y;
				var lenPx = Math.sqrt( dx * dx + dy * dy );
				if ( lenPx < 5 ) { return; }
				var real = parseFloat( window.prompt( 'How long is this line in metres?', '' ) );
				if ( ! isNaN( real ) && real > 0 ) {
					pxPerM = lenPx / real;
					scaleLine = { x1: start.x, y1: start.y, x2: cur.x, y2: cur.y };
					setStatus( 'Scale set: ' + Math.round( pxPerM ) + ' px/m. Now draw zones.' );
					tool = 'zone';
				}
			} else {
				var x = Math.min( start.x, cur.x ), y = Math.min( start.y, cur.y );
				var w = Math.abs( cur.x - start.x ), h = Math.abs( cur.y - start.y );
				if ( w < 5 || h < 5 ) { return; }
				if ( pxPerM <= 0 ) {
					setStatus( 'Set the scale first.' );
					redraw();
					return;
				}
				var wm = Math.round( metres( w ) * 100 ) / 100;
				var lm = Math.round( metres( h ) * 100 ) / 100;
				// Fill the first empty row, else add a new one.
				var rows = tbody.querySelectorAll( '[data-hgd-zone-row]' );
				var target = null;
				for ( var i = 0; i < rows.length; i++ ) {
					var rl = rows[ i ].querySelector( '[data-hgd-z-label]' ).value.trim();
					var rw = rows[ i ].querySelector( '[data-hgd-z-w]' ).value;
					if ( ! rl && ! rw && ! rows[ i ]._hgdRect ) { target = rows[ i ]; break; }
				}
				if ( ! target ) { target = makeRow(); tbody.appendChild( target ); }
				target.querySelector( '[data-hgd-z-w]' ).value = wm;
				target.querySelector( '[data-hgd-z-l]' ).value = lm;
				if ( ! target.querySelector( '[data-hgd-z-label]' ).value ) {
					target.querySelector( '[data-hgd-z-label]' ).value = 'Zone ' + rows.length;
				}
				target._hgdRect = { x: x, y: y, w: w, h: h };
				recalcAll();
			}
			redraw();
		} );

		root.querySelectorAll( '[data-hgd-tool]' ).forEach( function ( btn ) {
			btn.addEventListener( 'click', function () {
				tool = btn.getAttribute( 'data-hgd-tool' );
				setStatus( tool === 'scale' ? 'Drag a line over a known distance.' : 'Drag a rectangle for a zone.' );
			} );
		} );

		var clearBtn = root.querySelector( '[data-hgd-canvas-clear]' );
		if ( clearBtn ) {
			clearBtn.addEventListener( 'click', function () {
				tbody.querySelectorAll( '[data-hgd-zone-row]' ).forEach( function ( r ) { r._hgdRect = null; } );
				scaleLine = null;
				redraw();
				setStatus( 'Drawing cleared (table kept).' );
			} );
		}

		// Reveal the draw tool (progressive enhancement: only with canvas).
		if ( toggle && wrap ) {
			toggle.classList.remove( 'hgd-hidden' );
			toggle.addEventListener( 'click', function () {
				wrap.classList.toggle( 'hgd-hidden' );
				if ( ! wrap.classList.contains( 'hgd-hidden' ) ) {
					setStatus( pxPerM > 0 ? 'Scale ready. Draw zones.' : 'Set the scale first.' );
					redraw();
				}
			} );
		}

		// Load the satellite backdrop if present.
		var satEl = root.querySelector( '[data-hgd-measure-sat]' );
		if ( satEl && satEl.value ) {
			var img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = function () { bg = img; redraw(); };
			img.src = satEl.value;
		}

		recalcAll();
		drawGrid();
	} );
}() );

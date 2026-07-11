/* Hillcroft Garden Designer — render-fidelity studio.
 *
 * Two canvases:
 *   1. Existing-conditions editor: confirm/correct the AI-proposed fixed layer
 *      (boundary + retained features + north) in a 0–1000 coordinate space that
 *      matches the server (HGD_Site_Model / HGD_Base_Plan).
 *   2. Masking canvas: circle-and-fix — paint the wrong area of a render into a
 *      binary mask PNG (white = change) posted to the inpaint handler.
 */
( function () {
	'use strict';

	var COORD_W = 1000, COORD_H = 750;

	// ---- 1. Existing-conditions editor -------------------------------------
	function initExistingEditor( root ) {
		var canvas = root.querySelector( 'canvas' );
		var input  = root.querySelector( '[data-existing-json]' );
		var edgesBox = root.querySelector( '[data-edges]' );
		var northInput = root.querySelector( '[data-north]' );
		if ( ! canvas || ! input ) { return; }
		var ctx = canvas.getContext( '2d' );
		canvas.width = COORD_W; canvas.height = COORD_H;

		var bg = null;
		var bgUrl = root.getAttribute( 'data-bg' );
		if ( bgUrl ) {
			bg = new Image();
			bg.onload = draw;
			bg.src = bgUrl;
		}

		var model = { boundary: [], edges: [], features: [], orientation: { north_deg: 0, sun_notes: '' } };
		try {
			var seed = JSON.parse( input.value || '{}' );
			if ( seed && typeof seed === 'object' ) {
				model.boundary = seed.boundary || [];
				model.edges = seed.edges || [];
				model.features = seed.features || [];
				model.orientation = seed.orientation || model.orientation;
			}
		} catch ( e ) {}

		var tool = 'boundary';
		var boundaryClosed = model.boundary.length > 2;

		root.querySelectorAll( '[data-tool]' ).forEach( function ( b ) {
			b.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				tool = b.getAttribute( 'data-tool' );
				root.querySelectorAll( '[data-tool]' ).forEach( function ( x ) { x.classList.remove( 'is-active' ); } );
				b.classList.add( 'is-active' );
			} );
		} );
		var finishBtn = root.querySelector( '[data-finish-boundary]' );
		if ( finishBtn ) { finishBtn.addEventListener( 'click', function ( e ) { e.preventDefault(); boundaryClosed = true; rebuildEdges(); sync(); } ); }
		var undoBtn = root.querySelector( '[data-undo]' );
		if ( undoBtn ) { undoBtn.addEventListener( 'click', function ( e ) { e.preventDefault(); undo(); } ); }
		var clearBtn = root.querySelector( '[data-clear]' );
		if ( clearBtn ) { clearBtn.addEventListener( 'click', function ( e ) { e.preventDefault(); if ( window.confirm( 'Clear the existing-conditions layer?' ) ) { model = { boundary: [], edges: [], features: [], orientation: { north_deg: 0, sun_notes: '' } }; boundaryClosed = false; sync(); } } ); }
		if ( northInput ) {
			northInput.value = model.orientation.north_deg || 0;
			northInput.addEventListener( 'input', function () { model.orientation.north_deg = parseFloat( northInput.value ) || 0; sync(); } );
		}

		canvas.addEventListener( 'click', function ( ev ) {
			var p = toCoord( ev );
			if ( 'boundary' === tool && ! boundaryClosed ) {
				if ( model.boundary.length > 2 && dist( p, model.boundary[0] ) < 20 ) {
					boundaryClosed = true; rebuildEdges();
				} else {
					model.boundary.push( p );
				}
			} else if ( 'tree' === tool ) {
				model.features.push( { kind: 'tree', retain: true, cx: p.x, cy: p.y, r: 45, w: 0, h: 0, notes: '' } );
			} else if ( 'structure' === tool ) {
				model.features.push( { kind: 'structure', retain: true, cx: p.x, cy: p.y, r: 0, w: 60, h: 60, notes: '' } );
			} else if ( 'level' === tool ) {
				model.features.push( { kind: 'level_change', retain: true, cx: p.x, cy: p.y, r: 0, w: 80, h: 0, notes: '' } );
			} else if ( 'access' === tool ) {
				model.features.push( { kind: 'access', retain: true, cx: p.x, cy: p.y, r: 0, w: 0, h: 0, notes: 'access' } );
			}
			sync();
		} );

		function rebuildEdges() {
			var n = model.boundary.length, out = [];
			for ( var i = 0; i < n; i++ ) {
				out.push( model.edges[i] || { treatment: 'open' } );
			}
			model.edges = out;
			renderEdgeControls();
		}

		function renderEdgeControls() {
			if ( ! edgesBox ) { return; }
			edgesBox.innerHTML = '';
			if ( ! boundaryClosed ) { return; }
			model.edges.forEach( function ( edge, i ) {
				var wrap = document.createElement( 'label' );
				wrap.className = 'hgd-edge-ctl';
				wrap.textContent = 'Edge ' + ( i + 1 ) + ' ';
				var sel = document.createElement( 'select' );
				[ 'open', 'house_wall', 'wall', 'fence', 'hedge' ].forEach( function ( t ) {
					var o = document.createElement( 'option' );
					o.value = t; o.textContent = t.replace( '_', ' ' );
					if ( edge.treatment === t ) { o.selected = true; }
					sel.appendChild( o );
				} );
				sel.addEventListener( 'change', function () { model.edges[i].treatment = sel.value; sync(); } );
				wrap.appendChild( sel );
				edgesBox.appendChild( wrap );
			} );
		}

		function undo() {
			if ( ! boundaryClosed && model.boundary.length ) { model.boundary.pop(); }
			else if ( model.features.length ) { model.features.pop(); }
			sync();
		}

		function toCoord( ev ) {
			var r = canvas.getBoundingClientRect();
			return {
				x: Math.round( ( ev.clientX - r.left ) / r.width * COORD_W ),
				y: Math.round( ( ev.clientY - r.top ) / r.height * COORD_H )
			};
		}
		function dist( a, b ) { return Math.hypot( a.x - b.x, a.y - b.y ); }

		function draw() {
			ctx.clearRect( 0, 0, COORD_W, COORD_H );
			ctx.fillStyle = '#fbf9f3'; ctx.fillRect( 0, 0, COORD_W, COORD_H );
			if ( bg && bg.complete ) {
				ctx.globalAlpha = 0.5;
				var s = Math.min( COORD_W / bg.width, COORD_H / bg.height );
				ctx.drawImage( bg, 0, 0, bg.width * s, bg.height * s );
				ctx.globalAlpha = 1;
			}
			// boundary
			if ( model.boundary.length ) {
				ctx.beginPath();
				model.boundary.forEach( function ( p, i ) { i ? ctx.lineTo( p.x, p.y ) : ctx.moveTo( p.x, p.y ); } );
				if ( boundaryClosed ) { ctx.closePath(); }
				ctx.strokeStyle = '#494a20'; ctx.lineWidth = 3; ctx.stroke();
				model.boundary.forEach( function ( p ) {
					ctx.beginPath(); ctx.arc( p.x, p.y, 5, 0, 6.29 ); ctx.fillStyle = '#494a20'; ctx.fill();
				} );
			}
			// features
			model.features.forEach( function ( f ) {
				ctx.strokeStyle = '#5a7d3c'; ctx.fillStyle = 'rgba(90,125,60,.2)'; ctx.lineWidth = 2;
				if ( 'tree' === f.kind ) {
					ctx.beginPath(); ctx.arc( f.cx, f.cy, f.r || 40, 0, 6.29 ); ctx.fill(); ctx.stroke();
				} else if ( 'structure' === f.kind ) {
					ctx.fillStyle = 'rgba(140,120,60,.3)'; ctx.strokeStyle = '#494a20';
					ctx.fillRect( f.cx - ( f.w || 60 ) / 2, f.cy - ( f.h || 60 ) / 2, f.w || 60, f.h || 60 );
					ctx.strokeRect( f.cx - ( f.w || 60 ) / 2, f.cy - ( f.h || 60 ) / 2, f.w || 60, f.h || 60 );
				} else if ( 'level_change' === f.kind ) {
					ctx.strokeStyle = '#a8752b'; ctx.beginPath(); ctx.moveTo( f.cx - 40, f.cy ); ctx.lineTo( f.cx + 40, f.cy ); ctx.lineWidth = 4; ctx.stroke();
				} else {
					ctx.strokeStyle = '#494a20'; ctx.beginPath(); ctx.arc( f.cx, f.cy, 8, 0, 6.29 ); ctx.stroke();
				}
			} );
		}

		function sync() { input.value = JSON.stringify( model ); draw(); }

		renderEdgeControls();
		sync();
	}

	// ---- 2. Masking canvas (circle-and-fix) --------------------------------
	// A visible overlay canvas (translucent, so Donna sees what she paints over
	// the render) plus an offscreen black/white mask that is what gets posted.
	function initMaskCanvas( root ) {
		var img = root.querySelector( 'img[data-render]' );
		var overlay = root.querySelector( 'canvas[data-mask]' );
		var maskField = root.querySelector( '[data-mask-data]' );
		var brushInput = root.querySelector( '[data-brush]' );
		if ( ! img || ! overlay || ! maskField ) { return; }

		var octx = overlay.getContext( '2d' );
		var mask = document.createElement( 'canvas' );      // offscreen b/w mask
		var mctx = mask.getContext( '2d' );
		var painted = false;

		function sizeToImage() {
			var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
			if ( ! w || ! h ) { return; }
			overlay.width = w; overlay.height = h;
			mask.width = w; mask.height = h;
			reset();
		}
		function reset() {
			octx.clearRect( 0, 0, overlay.width, overlay.height );
			mctx.fillStyle = '#000'; mctx.fillRect( 0, 0, mask.width, mask.height );
			maskField.value = ''; painted = false;
		}
		if ( img.complete ) { sizeToImage(); } else { img.addEventListener( 'load', sizeToImage ); }

		var drawing = false;
		function brush() { return parseInt( brushInput && brushInput.value, 10 ) || 40; }
		function at( ev ) {
			var r = overlay.getBoundingClientRect();
			return { x: ( ev.clientX - r.left ) / r.width * overlay.width, y: ( ev.clientY - r.top ) / r.height * overlay.height };
		}
		function paint( ev ) {
			var p = at( ev ), b = brush();
			octx.fillStyle = 'rgba(220,40,40,0.45)';
			octx.beginPath(); octx.arc( p.x, p.y, b, 0, 6.29 ); octx.fill();
			mctx.fillStyle = '#fff';
			mctx.beginPath(); mctx.arc( p.x, p.y, b, 0, 6.29 ); mctx.fill();
			painted = true;
		}
		overlay.addEventListener( 'mousedown', function ( e ) { e.preventDefault(); drawing = true; paint( e ); } );
		overlay.addEventListener( 'mousemove', function ( e ) { if ( drawing ) { paint( e ); } } );
		window.addEventListener( 'mouseup', function () { if ( drawing ) { drawing = false; if ( painted ) { maskField.value = mask.toDataURL( 'image/png' ); } } } );

		var clearBtn = root.querySelector( '[data-mask-clear]' );
		if ( clearBtn ) { clearBtn.addEventListener( 'click', function ( e ) { e.preventDefault(); reset(); } ); }

		var form = root.closest( 'form' );
		if ( form ) {
			form.addEventListener( 'submit', function ( e ) {
				if ( ! painted ) {
					e.preventDefault();
					window.alert( 'Paint over the area to change first.' );
					return;
				}
				maskField.value = mask.toDataURL( 'image/png' );
			} );
		}
	}

	function boot() {
		document.querySelectorAll( '[data-hgd-existing-editor]' ).forEach( initExistingEditor );
		document.querySelectorAll( '[data-hgd-mask-canvas]' ).forEach( initMaskCanvas );
	}
	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
} )();

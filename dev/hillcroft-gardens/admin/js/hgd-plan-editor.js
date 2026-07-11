/* Hillcroft Garden Designer — vector plan editor (Konva).
 *
 * The plan is a structured, human-editable document: boundary, named zones,
 * retained features, dimensions and typed note/labels — all editable text and
 * shapes, never an AI-drawn image. Claude pre-fills it as a first draft; the
 * designer corrects every label and shape here. Serialised to a hidden field
 * (HGD_Plan_Doc shape) and rendered deterministically by the server.
 */
( function () {
	'use strict';
	if ( typeof Konva === 'undefined' ) { return; }

	var W = 1000, H = 750;

	function emptyPlan() {
		return { meta: { title: '', date: '' }, boundary: [], edges: [], zones: [], features: [],
			dimensions: [], annotations: [], labels: [], orientation: { north_deg: 0, sun_notes: '' } };
	}
	function uid( p ) { return p + Math.floor( Math.random() * 1e9 ).toString( 36 ); }

	function initPlanEditor( root ) {
		var seedInput = root.querySelector( '[data-plan-json]' );
		var container = root.querySelector( '[data-konva]' );
		if ( ! seedInput || ! container ) { return; }

		var plan = emptyPlan();
		try { var s = JSON.parse( seedInput.value || '{}' ); if ( s && typeof s === 'object' ) { plan = Object.assign( emptyPlan(), s ); } } catch ( e ) {}

		var displayW = container.clientWidth || 680;
		var scale = displayW / W;
		var stage = new Konva.Stage( { container: container, width: W * scale, height: H * scale, scaleX: scale, scaleY: scale } );
		var bgLayer = new Konva.Layer(), shapeLayer = new Konva.Layer();
		stage.add( bgLayer ); stage.add( shapeLayer );

		var bgUrl = root.getAttribute( 'data-bg' );
		if ( bgUrl ) {
			var im = new Image();
			im.onload = function () {
				var s2 = Math.min( W / im.width, H / im.height );
				bgLayer.add( new Konva.Image( { image: im, opacity: 0.4, width: im.width * s2, height: im.height * s2 } ) );
				bgLayer.draw();
			};
			im.src = bgUrl;
		}

		var tool = 'select';
		var temp = [];        // in-progress polygon points
		var dimFirst = null;  // first dimension endpoint

		root.querySelectorAll( '[data-tool]' ).forEach( function ( b ) {
			b.addEventListener( 'click', function ( e ) {
				e.preventDefault(); setTool( b.getAttribute( 'data-tool' ) );
			} );
		} );
		bindBtn( 'data-finish', finishPolygon );
		bindBtn( 'data-undo', function () { if ( temp.length ) { temp.pop(); render(); } } );
		bindBtn( 'data-clear', function () { if ( window.confirm( 'Clear the whole plan?' ) ) { plan = emptyPlan(); temp = []; render(); } } );
		var titleInput = root.querySelector( '[data-plan-title]' );
		if ( titleInput ) { titleInput.value = plan.meta.title || ''; titleInput.addEventListener( 'input', function () { plan.meta.title = titleInput.value; sync(); } ); }
		var northInput = root.querySelector( '[data-north]' );
		if ( northInput ) { northInput.value = plan.orientation.north_deg || 0; northInput.addEventListener( 'input', function () { plan.orientation.north_deg = parseFloat( northInput.value ) || 0; sync(); } ); }

		function bindBtn( attr, fn ) { var b = root.querySelector( '[' + attr + ']' ); if ( b ) { b.addEventListener( 'click', function ( e ) { e.preventDefault(); fn(); } ); } }
		function setTool( t ) {
			tool = t; temp = []; dimFirst = null;
			root.querySelectorAll( '[data-tool]' ).forEach( function ( x ) { x.classList.toggle( 'is-active', x.getAttribute( 'data-tool' ) === t ); } );
			render();
		}

		stage.on( 'click tap', function ( ev ) {
			var pos = stage.getRelativePointerPosition();
			var p = { x: Math.round( pos.x ), y: Math.round( pos.y ) };
			if ( 'select' === tool || 'delete' === tool ) { return; }

			if ( 'boundary' === tool || 'zone' === tool ) {
				temp.push( p ); render(); return;
			}
			if ( 'dimension' === tool ) {
				if ( ! dimFirst ) { dimFirst = p; render(); }
				else {
					var lbl = window.prompt( 'Dimension label (e.g. 6.5m):', '' ) || '';
					plan.dimensions.push( { id: uid( 'd' ), ax: dimFirst.x, ay: dimFirst.y, bx: p.x, by: p.y, label: lbl } );
					dimFirst = null; render();
				}
				return;
			}
			if ( 'circle' === tool ) {
				var ct = window.prompt( 'Note for this circled area:', '' ) || '';
				plan.annotations.push( { id: uid( 'a' ), kind: 'circle', x: p.x, y: p.y, r: 60, text: ct } ); render(); return;
			}
			if ( 'note' === tool ) {
				var nt = window.prompt( 'Note text:', '' ); if ( nt ) { plan.annotations.push( { id: uid( 'a' ), kind: 'note', x: p.x, y: p.y, r: 0, text: nt } ); render(); } return;
			}
			if ( 'label' === tool ) {
				var lt = window.prompt( 'Label text:', '' ); if ( lt ) { plan.labels.push( { id: uid( 'l' ), x: p.x, y: p.y, text: lt } ); render(); } return;
			}
			// Feature tools.
			var kinds = { tree: 1, structure: 1, level: 1, access: 1, water: 1 };
			if ( kinds[ tool ] ) {
				var kind = 'level' === tool ? 'level_change' : tool;
				var label = window.prompt( 'Label (optional, e.g. “existing oak”):', '' ) || '';
				var f = { id: uid( 'f' ), kind: kind, retain: true, label: label, cx: p.x, cy: p.y, r: 0, w: 0, h: 0 };
				if ( 'tree' === kind ) { f.r = 40; } else if ( 'water' === kind ) { f.w = 80; f.h = 50; } else if ( 'level_change' === kind ) { f.w = 80; } else if ( 'structure' === kind ) { f.w = 60; f.h = 60; }
				plan.features.push( f ); render();
			}
		} );

		function finishPolygon() {
			if ( temp.length < 3 ) { temp = []; render(); return; }
			if ( 'boundary' === tool ) {
				plan.boundary = temp.slice();
				plan.edges = plan.boundary.map( function () { return { treatment: 'open' }; } );
				renderEdgeControls();
			} else if ( 'zone' === tool ) {
				var name = window.prompt( 'Zone name (e.g. “Main lawn”):', '' ) || '';
				var type = window.prompt( 'Zone type: lawn, border, patio, path, water, planting, structure, other', 'border' ) || 'other';
				plan.zones.push( { id: uid( 'z' ), name: name, type: type, fixed: false, points: temp.slice() } );
			} else {
				// Not in a shape tool — discard the stray points rather than guess.
				temp = []; render(); return;
			}
			temp = []; render();
		}

		// Edit / delete on shapes -------------------------------------------------
		function onShape( node, coll, item ) {
			node.on( 'dblclick dbltap', function () { editText( coll, item ); } );
			node.on( 'click tap', function ( ev ) {
				if ( 'delete' === tool ) { ev.cancelBubble = true; removeItem( coll, item ); }
			} );
			if ( 'select' === tool ) {
				node.draggable( true );
				node.on( 'dragend', function () { shiftItem( coll, item, node.x(), node.y() ); node.position( { x: 0, y: 0 } ); render(); } );
			}
		}
		function editText( coll, item ) {
			if ( 'boundary' === coll ) { return; } // boundary has no text.
			var key = ( 'labels' === coll || 'annotations' === coll ) ? 'text' : 'label';
			if ( 'zones' === coll ) { key = 'name'; }
			var cur = item[ key ] || '';
			var v = window.prompt( 'Edit text:', cur );
			if ( null !== v ) { item[ key ] = v; render(); }
		}
		function removeItem( coll, item ) {
			if ( 'boundary' === coll ) { plan.boundary = []; plan.edges = []; renderEdgeControls(); render(); return; }
			plan[ coll ] = plan[ coll ].filter( function ( x ) { return x !== item; } );
			render();
		}
		function shiftItem( coll, item, dx, dy ) {
			if ( 'boundary' === coll ) { plan.boundary = plan.boundary.map( function ( p ) { return { x: p.x + dx, y: p.y + dy }; } ); return; }
			if ( item.points ) { item.points = item.points.map( function ( p ) { return { x: p.x + dx, y: p.y + dy }; } ); }
			if ( 'cx' in item ) { item.cx += dx; item.cy += dy; }
			if ( 'x' in item ) { item.x += dx; item.y += dy; }
			if ( 'ax' in item ) { item.ax += dx; item.ay += dy; item.bx += dx; item.by += dy; }
		}

		// Render everything from the model ---------------------------------------
		var EDGE = { house_wall: '#1b1c18', wall: '#494a20', fence: '#8a8a5a', hedge: '#5a7d3c', open: '#c1c1a8' };
		var ZONE = { lawn: '#dfe7c8', border: '#e7dcc0', planting: '#dfe7c8', patio: '#e6e2d8', path: '#e9e4d5', water: '#cfe0e6', structure: '#d8d3c0', other: '#eeeae0' };

		function flat( pts ) { var a = []; pts.forEach( function ( p ) { a.push( p.x, p.y ); } ); return a; }
		function centroid( pts ) { var x = 0, y = 0; pts.forEach( function ( p ) { x += p.x; y += p.y; } ); return { x: x / pts.length, y: y / pts.length }; }
		function grp() { return new Konva.Group( { x: 0, y: 0 } ); }

		function render() {
			shapeLayer.destroyChildren();

			// zones
			plan.zones.forEach( function ( z ) {
				var g = grp();
				g.add( new Konva.Line( { points: flat( z.points ), closed: true, fill: ZONE[ z.type ] || ZONE.other, opacity: 0.85, stroke: '#9aa06a', strokeWidth: 1.5 } ) );
				var c = centroid( z.points );
				g.add( new Konva.Text( { x: c.x - 60, y: c.y - 8, width: 120, align: 'center', text: z.name || z.type, fontSize: 15, fontStyle: '600', fill: '#33351c' } ) );
				shapeLayer.add( g ); onShape( g, 'zones', z );
			} );

			// boundary
			if ( plan.boundary.length >= 2 ) {
				var gb = grp();
				for ( var i = 0; i < plan.boundary.length; i++ ) {
					var a = plan.boundary[ i ], b = plan.boundary[ ( i + 1 ) % plan.boundary.length ];
					var t = ( plan.edges[ i ] && plan.edges[ i ].treatment ) || 'open';
					gb.add( new Konva.Line( { points: [ a.x, a.y, b.x, b.y ], stroke: EDGE[ t ] || EDGE.open, strokeWidth: 'house_wall' === t ? 6 : ( 'hedge' === t ? 7 : 3 ), dash: ( 'fence' === t || 'open' === t ) ? [ 8, 4 ] : undefined } ) );
				}
				plan.boundary.forEach( function ( p ) { gb.add( new Konva.Circle( { x: p.x, y: p.y, radius: 4, fill: '#494a20' } ) ); } );
				shapeLayer.add( gb ); onShape( gb, 'boundary', null );
			}

			// features
			plan.features.forEach( function ( f ) {
				var g = grp(), op = f.retain ? 1 : 0.4;
				if ( 'tree' === f.kind ) {
					g.add( new Konva.Circle( { x: f.cx, y: f.cy, radius: f.r || 40, fill: 'rgba(90,125,60,0.18)', stroke: '#5a7d3c', strokeWidth: 1.5, dash: [ 4, 3 ], opacity: op } ) );
					g.add( new Konva.Circle( { x: f.cx, y: f.cy, radius: 4, fill: '#3f5a26', opacity: op } ) );
				} else if ( 'water' === f.kind ) {
					g.add( new Konva.Ellipse( { x: f.cx, y: f.cy, radiusX: ( f.w || 80 ) / 2, radiusY: ( f.h || 50 ) / 2, fill: '#cfe0e6', stroke: '#6c93a0', strokeWidth: 1.5, opacity: op } ) );
				} else if ( 'level_change' === f.kind ) {
					g.add( new Konva.Line( { points: [ f.cx - ( f.w || 80 ) / 2, f.cy, f.cx + ( f.w || 80 ) / 2, f.cy ], stroke: '#a8752b', strokeWidth: 3, dash: [ 10, 4 ], opacity: op } ) );
				} else if ( 'access' === f.kind ) {
					g.add( new Konva.Circle( { x: f.cx, y: f.cy, radius: 8, stroke: '#494a20', strokeWidth: 2, opacity: op } ) );
				} else {
					g.add( new Konva.Rect( { x: f.cx - ( f.w || 44 ) / 2, y: f.cy - ( f.h || 44 ) / 2, width: f.w || 44, height: f.h || 44, fill: '#d8d3c0', stroke: '#494a20', strokeWidth: 1.5, opacity: op } ) );
				}
				if ( f.label ) { g.add( new Konva.Text( { x: f.cx - 70, y: f.cy - ( f.r > 0 ? f.r + 20 : 34 ), width: 140, align: 'center', text: f.label, fontSize: 12, fill: '#1b1c18', opacity: op } ) ); }
				shapeLayer.add( g ); onShape( g, 'features', f );
			} );

			// dimensions
			plan.dimensions.forEach( function ( d ) {
				var g = grp();
				g.add( new Konva.Line( { points: [ d.ax, d.ay, d.bx, d.by ], stroke: '#5a5a3a', strokeWidth: 1.2 } ) );
				g.add( new Konva.Circle( { x: d.ax, y: d.ay, radius: 3, fill: '#5a5a3a' } ) );
				g.add( new Konva.Circle( { x: d.bx, y: d.by, radius: 3, fill: '#5a5a3a' } ) );
				if ( d.label ) { g.add( new Konva.Text( { x: ( d.ax + d.bx ) / 2 - 30, y: ( d.ay + d.by ) / 2 - 8, width: 60, align: 'center', text: d.label, fontSize: 12, fontStyle: '600', fill: '#3a3a24' } ) ); }
				shapeLayer.add( g ); onShape( g, 'dimensions', d );
			} );

			// annotations
			plan.annotations.forEach( function ( a ) {
				var g = grp();
				if ( 'circle' === a.kind ) { g.add( new Konva.Circle( { x: a.x, y: a.y, radius: a.r || 60, stroke: '#c0392b', strokeWidth: 2, dash: [ 6, 4 ] } ) ); }
				if ( a.text ) { g.add( new Konva.Text( { x: a.x - 90, y: a.y + ( 'circle' === a.kind ? ( a.r || 60 ) + 6 : 0 ), width: 180, align: 'center', text: a.text, fontSize: 12, fontStyle: '500', fill: '#c0392b' } ) ); }
				shapeLayer.add( g ); onShape( g, 'annotations', a );
			} );

			// labels
			plan.labels.forEach( function ( l ) {
				var g = grp();
				g.add( new Konva.Text( { x: l.x - 90, y: l.y - 8, width: 180, align: 'center', text: l.text, fontSize: 13, fill: '#1b1c18' } ) );
				shapeLayer.add( g ); onShape( g, 'labels', l );
			} );

			// in-progress polygon
			if ( temp.length ) {
				var gt = grp();
				gt.add( new Konva.Line( { points: flat( temp ), stroke: '#c0392b', strokeWidth: 2, dash: [ 6, 4 ] } ) );
				temp.forEach( function ( p ) { gt.add( new Konva.Circle( { x: p.x, y: p.y, radius: 4, fill: '#c0392b' } ) ); } );
				shapeLayer.add( gt );
			}

			shapeLayer.draw();
			sync();
		}

		function renderEdgeControls() {
			var box = root.querySelector( '[data-edges]' );
			if ( ! box ) { return; }
			box.innerHTML = '';
			plan.edges.forEach( function ( edge, i ) {
				var wrap = document.createElement( 'label' );
				wrap.className = 'hgd-edge-ctl';
				wrap.textContent = 'Edge ' + ( i + 1 ) + ' ';
				var sel = document.createElement( 'select' );
				[ 'open', 'house_wall', 'wall', 'fence', 'hedge' ].forEach( function ( t ) {
					var o = document.createElement( 'option' ); o.value = t; o.textContent = t.replace( '_', ' ' );
					if ( edge.treatment === t ) { o.selected = true; } sel.appendChild( o );
				} );
				sel.addEventListener( 'change', function () { plan.edges[ i ].treatment = sel.value; render(); } );
				wrap.appendChild( sel ); box.appendChild( wrap );
			} );
		}

		function sync() { seedInput.value = JSON.stringify( plan ); }

		renderEdgeControls();
		render();
	}

	function boot() { document.querySelectorAll( '[data-hgd-plan-editor]' ).forEach( initPlanEditor ); }
	if ( 'loading' === document.readyState ) { document.addEventListener( 'DOMContentLoaded', boot ); } else { boot(); }
} )();

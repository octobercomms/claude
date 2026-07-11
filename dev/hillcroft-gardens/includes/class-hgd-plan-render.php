<?php
/**
 * Deterministic renderer for the plan doc (HGD_Plan_Doc) → a clean, labelled
 * technical garden plan. Pure code: boundary, edge treatments, named zones,
 * retained features, dimension lines, note annotations, north arrow, scale bar
 * and a title block. No generative model — so the drawing is exact, legible and
 * reproducible, and every word on it is real editable text (not smudge).
 *
 * Output is stored as the project's `base_plan` asset and used as the structural
 * anchor (ControlNet) for the photoreal renders.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Plan_Render {

	const W = 1000;
	const H = 750;
	const FOOT = 120; // title-block strip height below the drawing.

	private static $zone_fill = array(
		'lawn'      => '#dfe7c8',
		'border'    => '#e7dcc0',
		'planting'  => '#dfe7c8',
		'patio'     => '#e6e2d8',
		'path'      => '#e9e4d5',
		'water'     => '#cfe0e6',
		'structure' => '#d8d3c0',
		'other'     => '#eeeae0',
	);

	public static function can_rasterise() {
		return class_exists( 'Imagick' );
	}

	/** @return int|WP_Error attachment id. */
	public static function generate_and_store( $project_id ) {
		$project = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_plan_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}
		$plan = HGD_Plan_Doc::get( $project );
		if ( ! HGD_Plan_Doc::has_data( $plan ) ) {
			return new WP_Error( 'hgd_plan_no_data', __( 'Draw or detect the plan (boundary + zones) before rendering it.', 'hillcroft-garden-designer' ) );
		}

		$svg = self::svg( $project, $plan );
		if ( self::can_rasterise() ) {
			try {
				$im = new Imagick();
				$im->setBackgroundColor( new ImagickPixel( 'white' ) );
				$im->readImageBlob( $svg );
				$im->setImageFormat( 'png' );
				$bytes = $im->getImageBlob();
				$mime  = 'image/png';
				$im->clear();
			} catch ( Exception $e ) {
				HGD_Log::warning( 'plan_render.raster', 'Imagick failed: ' . $e->getMessage(), array( 'project_id' => (int) $project_id ) );
				$bytes = $svg; $mime = 'image/svg+xml';
			}
		} else {
			$bytes = $svg; $mime = 'image/svg+xml';
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $bytes, $mime, $project_id, 'plan' );
		if ( is_wp_error( $att_id ) ) {
			return $att_id;
		}
		foreach ( HGD_Project_Asset::for_project( $project_id, 'base_plan' ) as $old ) {
			HGD_Project_Asset::delete( (int) $old['id'] );
		}
		HGD_Project_Asset::add( $project_id, $att_id, 'base_plan', 'plan', __( 'Digitised plan (existing + design)', 'hillcroft-garden-designer' ) );
		return (int) $att_id;
	}

	public static function svg( $project, $plan = null ) {
		$p = null === $plan ? HGD_Plan_Doc::get( $project ) : $plan;
		$W = self::W; $H = self::H; $total_h = $H + self::FOOT;

		$svg  = sprintf( '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="DejaVu Sans, Arial, sans-serif">', $W, $total_h, $W, $total_h );
		$svg .= sprintf( '<rect width="%d" height="%d" fill="#ffffff"/>', $W, $total_h );
		// Faint grid for a technical feel.
		$svg .= '<g stroke="#eef0e6" stroke-width="1">';
		for ( $x = 0; $x <= $W; $x += 50 ) { $svg .= sprintf( '<line x1="%d" y1="0" x2="%d" y2="%d"/>', $x, $x, $H ); }
		for ( $y = 0; $y <= $H; $y += 50 ) { $svg .= sprintf( '<line x1="0" y1="%d" x2="%d" y2="%d"/>', $y, $W, $y ); }
		$svg .= '</g>';

		// Plot fill + boundary.
		if ( count( $p['boundary'] ) >= 3 ) {
			$poly = self::poly_points( $p['boundary'] );
			$svg .= '<polygon points="' . $poly . '" fill="#f7f6ef" stroke="none"/>';
		}

		// Zones (filled + named).
		foreach ( $p['zones'] as $z ) {
			$fill = isset( self::$zone_fill[ $z['type'] ] ) ? self::$zone_fill[ $z['type'] ] : self::$zone_fill['other'];
			$svg .= '<polygon points="' . self::poly_points( $z['points'] ) . '" fill="' . $fill . '" fill-opacity="0.85" stroke="#9aa06a" stroke-width="1.5"/>';
			$c = self::centroid( $z['points'] );
			$name = '' !== $z['name'] ? $z['name'] : $z['type'];
			$svg .= self::text( $c['x'], $c['y'], $name, 15, '#33351c', 'middle', 600 );
		}

		// Boundary edges by treatment (drawn over zones).
		$edge_style = array(
			'house_wall' => 'stroke="#1b1c18" stroke-width="7"',
			'wall'       => 'stroke="#494a20" stroke-width="4"',
			'fence'      => 'stroke="#8a8a5a" stroke-width="2" stroke-dasharray="8 4"',
			'hedge'      => 'stroke="#5a7d3c" stroke-width="8" stroke-linecap="round" opacity="0.75"',
			'open'       => 'stroke="#b9b9a2" stroke-width="1.5" stroke-dasharray="2 4"',
		);
		$n = count( $p['boundary'] );
		for ( $i = 0; $i < $n; $i++ ) {
			$a = $p['boundary'][ $i ];
			$b = $p['boundary'][ ( $i + 1 ) % $n ];
			$t = isset( $p['edges'][ $i ]['treatment'] ) ? $p['edges'][ $i ]['treatment'] : 'open';
			$style = isset( $edge_style[ $t ] ) ? $edge_style[ $t ] : $edge_style['open'];
			$svg  .= sprintf( '<line x1="%s" y1="%s" x2="%s" y2="%s" %s/>', self::f( $a['x'] ), self::f( $a['y'] ), self::f( $b['x'] ), self::f( $b['y'] ), $style );
		}

		// Features + labels.
		foreach ( $p['features'] as $f ) {
			$dim = empty( $f['retain'] ) ? ' opacity="0.4"' : '';
			if ( 'tree' === $f['kind'] ) {
				$r = $f['r'] > 0 ? $f['r'] : 26;
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="%s" fill="#5a7d3c" fill-opacity="0.18" stroke="#5a7d3c" stroke-width="1.5" stroke-dasharray="4 3"%s/>', self::f( $f['cx'] ), self::f( $f['cy'] ), self::f( $r ), $dim );
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="4" fill="#3f5a26"%s/>', self::f( $f['cx'] ), self::f( $f['cy'] ), $dim );
			} elseif ( 'water' === $f['kind'] ) {
				$svg .= sprintf( '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#cfe0e6" stroke="#6c93a0" stroke-width="1.5"%s/>', self::f( $f['cx'] ), self::f( $f['cy'] ), self::f( $f['w'] > 0 ? $f['w'] / 2 : 30 ), self::f( $f['h'] > 0 ? $f['h'] / 2 : 20 ), $dim );
			} elseif ( 'level_change' === $f['kind'] ) {
				$half = $f['w'] > 0 ? $f['w'] / 2 : 34;
				$svg .= sprintf( '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#a8752b" stroke-width="3" stroke-dasharray="10 4"%s/>', self::f( $f['cx'] - $half ), self::f( $f['cy'] ), self::f( $f['cx'] + $half ), self::f( $f['cy'] ), $dim );
			} elseif ( 'access' === $f['kind'] ) {
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="7" fill="none" stroke="#494a20" stroke-width="2"%s/>', self::f( $f['cx'] ), self::f( $f['cy'] ), $dim );
			} else {
				$sw = $f['w'] > 0 ? $f['w'] : 44; $sh = $f['h'] > 0 ? $f['h'] : 44;
				$svg .= sprintf( '<rect x="%s" y="%s" width="%s" height="%s" fill="#d8d3c0" stroke="#494a20" stroke-width="1.5"%s/>', self::f( $f['cx'] - $sw / 2 ), self::f( $f['cy'] - $sh / 2 ), self::f( $sw ), self::f( $sh ), $dim );
			}
			if ( '' !== $f['label'] ) {
				$svg .= self::text( $f['cx'], $f['cy'] - ( $f['r'] > 0 ? $f['r'] + 8 : 26 ), $f['label'], 12, '#1b1c18', 'middle', 400, $dim );
			}
		}

		// Dimension lines with end ticks + text.
		foreach ( $p['dimensions'] as $d ) {
			$svg .= sprintf( '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#5a5a3a" stroke-width="1.2"/>', self::f( $d['ax'] ), self::f( $d['ay'] ), self::f( $d['bx'] ), self::f( $d['by'] ) );
			foreach ( array( array( $d['ax'], $d['ay'] ), array( $d['bx'], $d['by'] ) ) as $pt ) {
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="3" fill="#5a5a3a"/>', self::f( $pt[0] ), self::f( $pt[1] ) );
			}
			if ( '' !== $d['label'] ) {
				$mx = ( $d['ax'] + $d['bx'] ) / 2; $my = ( $d['ay'] + $d['by'] ) / 2;
				$svg .= sprintf( '<rect x="%s" y="%s" width="%s" height="16" fill="#ffffff" opacity="0.85"/>', self::f( $mx - 22 ), self::f( $my - 12 ), 44 );
				$svg .= self::text( $mx, $my, $d['label'], 12, '#3a3a24', 'middle', 600 );
			}
		}

		// Note annotations (circles + callouts) and free labels.
		foreach ( $p['annotations'] as $a ) {
			if ( 'circle' === $a['kind'] ) {
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="%s" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 4"/>', self::f( $a['x'] ), self::f( $a['y'] ), self::f( $a['r'] > 0 ? $a['r'] : 40 ) );
			}
			if ( '' !== $a['text'] ) {
				$svg .= self::text( $a['x'], $a['y'] + ( 'circle' === $a['kind'] ? ( $a['r'] > 0 ? $a['r'] : 40 ) + 14 : 0 ), $a['text'], 12, '#c0392b', 'middle', 500 );
			}
		}
		foreach ( $p['labels'] as $l ) {
			$svg .= self::text( $l['x'], $l['y'], $l['text'], 13, '#1b1c18', 'middle', 400 );
		}

		// North arrow (top-right).
		$svg .= sprintf( '<g transform="translate(%d,%d) rotate(%s)"><line x1="0" y1="20" x2="0" y2="-20" stroke="#1b1c18" stroke-width="2"/><polygon points="0,-24 -6,-13 6,-13" fill="#1b1c18"/><text x="0" y="36" font-size="12" text-anchor="middle" fill="#1b1c18">N</text></g>', $W - 46, 46, self::f( $p['orientation']['north_deg'] ) );

		// Title block strip.
		$svg .= sprintf( '<line x1="0" y1="%d" x2="%d" y2="%d" stroke="#c9c8ba" stroke-width="1"/>', $H, $W, $H );
		$measure = class_exists( 'HGD_Measure' ) ? HGD_Measure::get( $project ) : array( 'plot' => array( 'w' => 0, 'l' => 0 ) );
		$title = '' !== $p['meta']['title'] ? $p['meta']['title'] : ( is_array( $project ) && ! empty( $project['title'] ) ? (string) $project['title'] : 'Garden plan' );
		$svg .= self::text( 16, $H + 34, $title, 18, '#1b1c18', 'start', 600 );
		$sub  = array();
		if ( '' !== $p['meta']['date'] ) { $sub[] = $p['meta']['date']; }
		if ( ! empty( $measure['plot']['w'] ) && ! empty( $measure['plot']['l'] ) ) {
			$sub[] = sprintf( '%s m × %s m', rtrim( rtrim( number_format( (float) $measure['plot']['w'], 2 ), '0' ), '.' ), rtrim( rtrim( number_format( (float) $measure['plot']['l'], 2 ), '0' ), '.' ) );
		}
		$sub[] = 'Existing conditions + proposed design — digitised, not AI-drawn';
		$svg .= self::text( 16, $H + 60, implode( '   ·   ', $sub ), 12, '#5a5a44', 'start', 400 );

		// Scale bar (only meaningful when plot dims known; indicative otherwise).
		$svg .= sprintf( '<g transform="translate(%d,%d)"><rect x="0" y="0" width="60" height="6" fill="#1b1c18"/><rect x="60" y="0" width="60" height="6" fill="#ffffff" stroke="#1b1c18" stroke-width="1"/><text x="0" y="22" font-size="11" fill="#1b1c18">0</text><text x="120" y="22" font-size="11" text-anchor="end" fill="#1b1c18">scale</text></g>', $W - 200, $H + 40 );

		$svg .= '</svg>';
		return $svg;
	}

	// -- helpers --------------------------------------------------------------

	private static function poly_points( $pts ) {
		$s = '';
		foreach ( $pts as $p ) {
			$s .= self::f( $p['x'] ) . ',' . self::f( $p['y'] ) . ' ';
		}
		return trim( $s );
	}

	private static function centroid( $pts ) {
		$x = 0; $y = 0; $n = max( 1, count( $pts ) );
		foreach ( $pts as $p ) { $x += $p['x']; $y += $p['y']; }
		return array( 'x' => $x / $n, 'y' => $y / $n );
	}

	private static function text( $x, $y, $str, $size, $fill, $anchor = 'start', $weight = 400, $extra = '' ) {
		return sprintf( '<text x="%s" y="%s" font-size="%d" fill="%s" text-anchor="%s" font-weight="%d"%s>%s</text>',
			self::f( $x ), self::f( $y ), (int) $size, $fill, $anchor, (int) $weight, $extra, esc_html( $str ) );
	}

	private static function f( $n ) {
		return rtrim( rtrim( number_format( (float) $n, 2, '.', '' ), '0' ), '.' );
	}
}

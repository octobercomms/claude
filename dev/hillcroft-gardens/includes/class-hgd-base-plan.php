<?php
/**
 * Deterministic technical base plan renderer.
 *
 * Draws the confirmed existing-conditions layer (HGD_Site_Model) as a clean,
 * scaled technical drawing — plot outline, edge treatments, retained trees /
 * structures, level changes, dimensions and a north arrow — as SVG, then
 * rasterises to PNG when Imagick is available.
 *
 * CRITICAL: there is NO generative model in here. The base plan is the "what
 * can't change" anchor; if AI drew it we'd reintroduce the very hallucination it
 * exists to prevent. It is rendered purely from confirmed data, so it is exact
 * and reproducible. It then becomes the ControlNet/plan anchor for generation.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Base_Plan {

	const PAD = 60; // px padding around the boundary in the drawing.

	/** Can we rasterise SVG → PNG on this host? */
	public static function can_rasterise() {
		return class_exists( 'Imagick' );
	}

	/**
	 * Build + store the base plan as a project asset (role 'base_plan'),
	 * replacing any prior one.
	 *
	 * @return int|WP_Error attachment id.
	 */
	public static function generate_and_store( $project_id ) {
		$project = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_bp_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}
		$existing = HGD_Site_Model::get( $project );
		if ( ! HGD_Site_Model::has_data( $existing ) ) {
			return new WP_Error( 'hgd_bp_no_data', __( 'Confirm the existing-conditions layer (boundary and any retained features) before generating a base plan.', 'hillcroft-garden-designer' ) );
		}

		$svg = self::svg( $project, $existing );

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
				HGD_Log::warning( 'base_plan.raster', 'Imagick SVG rasterise failed: ' . $e->getMessage(), array( 'project_id' => (int) $project_id ) );
				$bytes = $svg;
				$mime  = 'image/svg+xml';
			}
		} else {
			$bytes = $svg;
			$mime  = 'image/svg+xml';
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $bytes, $mime, $project_id, 'base-plan' );
		if ( is_wp_error( $att_id ) ) {
			return $att_id;
		}

		// One base plan per project — clear prior rows (and their attachments).
		foreach ( HGD_Project_Asset::for_project( $project_id, 'base_plan' ) as $old ) {
			HGD_Project_Asset::delete( (int) $old['id'] );
		}
		HGD_Project_Asset::add( $project_id, $att_id, 'base_plan', 'existing', __( 'Existing-conditions base plan', 'hillcroft-garden-designer' ) );
		return (int) $att_id;
	}

	/** The SVG document for a project's existing-conditions layer. */
	public static function svg( $project, $existing = null ) {
		$ex = null === $existing ? HGD_Site_Model::get( $project ) : $existing;

		// Bounding box of the boundary (fall back to a default frame).
		$minx = $miny = INF;
		$maxx = $maxy = -INF;
		foreach ( $ex['boundary'] as $p ) {
			$minx = min( $minx, $p['x'] ); $miny = min( $miny, $p['y'] );
			$maxx = max( $maxx, $p['x'] ); $maxy = max( $maxy, $p['y'] );
		}
		foreach ( $ex['features'] as $f ) {
			$minx = min( $minx, $f['cx'] - $f['r'] ); $miny = min( $miny, $f['cy'] - $f['r'] );
			$maxx = max( $maxx, $f['cx'] + $f['r'] ); $maxy = max( $maxy, $f['cy'] + $f['r'] );
		}
		if ( ! is_finite( $minx ) ) { $minx = 0; $miny = 0; $maxx = 800; $maxy = 600; }

		$w = ( $maxx - $minx ) + self::PAD * 2;
		$h = ( $maxy - $miny ) + self::PAD * 2;
		$ox = self::PAD - $minx;
		$oy = self::PAD - $miny;

		$measure = class_exists( 'HGD_Measure' ) ? HGD_Measure::get( $project ) : array( 'plot' => array( 'w' => 0, 'l' => 0 ) );

		$svg  = sprintf( '<svg xmlns="http://www.w3.org/2000/svg" width="%1$d" height="%2$d" viewBox="0 0 %1$d %2$d">', (int) ceil( $w ), (int) ceil( $h ) );
		$svg .= '<rect width="100%" height="100%" fill="#ffffff"/>';
		$svg .= '<g transform="translate(' . self::f( $ox ) . ',' . self::f( $oy ) . ')" font-family="DejaVu Sans, Arial, sans-serif">';

		// Edge styles by treatment.
		$edge_style = array(
			'house_wall' => 'stroke="#1b1c18" stroke-width="6"',
			'wall'       => 'stroke="#494a20" stroke-width="4"',
			'fence'      => 'stroke="#8a8a5a" stroke-width="2" stroke-dasharray="8 4"',
			'hedge'      => 'stroke="#5a7d3c" stroke-width="7" stroke-linecap="round" opacity="0.7"',
			'open'       => 'stroke="#b9b9a2" stroke-width="1.5" stroke-dasharray="2 4"',
		);

		$pts = $ex['boundary'];
		$n   = count( $pts );
		if ( $n >= 2 ) {
			// Faint fill for the plot.
			$poly = '';
			foreach ( $pts as $p ) {
				$poly .= self::f( $p['x'] ) . ',' . self::f( $p['y'] ) . ' ';
			}
			$svg .= '<polygon points="' . trim( $poly ) . '" fill="#f7f6ef" stroke="none"/>';

			// Per-segment edges (index-aligned to edges[]).
			for ( $i = 0; $i < $n; $i++ ) {
				$a = $pts[ $i ];
				$b = $pts[ ( $i + 1 ) % $n ];
				$t = isset( $ex['edges'][ $i ]['treatment'] ) ? $ex['edges'][ $i ]['treatment'] : 'open';
				$style = isset( $edge_style[ $t ] ) ? $edge_style[ $t ] : $edge_style['open'];
				$svg  .= sprintf( '<line x1="%s" y1="%s" x2="%s" y2="%s" %s/>',
					self::f( $a['x'] ), self::f( $a['y'] ), self::f( $b['x'] ), self::f( $b['y'] ), $style );
			}
		}

		// Features.
		foreach ( $ex['features'] as $f ) {
			$dim = empty( $f['retain'] ) ? ' opacity="0.35"' : '';
			if ( 'tree' === $f['kind'] ) {
				$r = $f['r'] > 0 ? $f['r'] : 24;
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="%s" fill="#5a7d3c" fill-opacity="0.18" stroke="#5a7d3c" stroke-width="1.5" stroke-dasharray="4 3"%s/>',
					self::f( $f['cx'] ), self::f( $f['cy'] ), self::f( $r ), $dim );
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="4" fill="#3f5a26"%s/>', self::f( $f['cx'] ), self::f( $f['cy'] ), $dim );
			} elseif ( 'level_change' === $f['kind'] ) {
				$svg .= sprintf( '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#a8752b" stroke-width="3" stroke-dasharray="10 4"%s/>',
					self::f( $f['cx'] - ( $f['w'] > 0 ? $f['w'] / 2 : 30 ) ), self::f( $f['cy'] ),
					self::f( $f['cx'] + ( $f['w'] > 0 ? $f['w'] / 2 : 30 ) ), self::f( $f['cy'] ), $dim );
			} elseif ( 'access' === $f['kind'] ) {
				$svg .= sprintf( '<circle cx="%s" cy="%s" r="7" fill="none" stroke="#494a20" stroke-width="2"%s/><text x="%s" y="%s" font-size="10" fill="#494a20"%s>access</text>',
					self::f( $f['cx'] ), self::f( $f['cy'] ), $dim, self::f( $f['cx'] + 10 ), self::f( $f['cy'] + 3 ), $dim );
			} else { // structure
				$sw = $f['w'] > 0 ? $f['w'] : 40;
				$sh = $f['h'] > 0 ? $f['h'] : 40;
				$svg .= sprintf( '<rect x="%s" y="%s" width="%s" height="%s" fill="#d8d3c0" stroke="#494a20" stroke-width="1.5"%s/>',
					self::f( $f['cx'] - $sw / 2 ), self::f( $f['cy'] - $sh / 2 ), self::f( $sw ), self::f( $sh ), $dim );
			}
			if ( '' !== $f['notes'] ) {
				$svg .= sprintf( '<text x="%s" y="%s" font-size="10" fill="#1b1c18"%s>%s</text>',
					self::f( $f['cx'] + 6 ), self::f( $f['cy'] - ( $f['r'] > 0 ? $f['r'] + 6 : 8 ) ), $dim, esc_html( $f['notes'] ) );
			}
		}

		// North arrow (top-right of the drawing area), rotated by north_deg.
		$nx = ( $maxx - $minx ) - 10;
		$ny = 10;
		$svg .= sprintf(
			'<g transform="translate(%s,%s) rotate(%s)"><line x1="0" y1="18" x2="0" y2="-18" stroke="#1b1c18" stroke-width="2"/><polygon points="0,-22 -5,-12 5,-12" fill="#1b1c18"/><text x="0" y="34" font-size="11" text-anchor="middle" fill="#1b1c18">N</text></g>',
			self::f( $nx ), self::f( $ny + 24 ), self::f( $ex['orientation']['north_deg'] )
		);

		// Plot dimension caption.
		$pw = (float) ( $measure['plot']['w'] ?? 0 );
		$pl = (float) ( $measure['plot']['l'] ?? 0 );
		if ( $pw > 0 && $pl > 0 ) {
			$svg .= sprintf( '<text x="0" y="%s" font-size="13" fill="#1b1c18">Plot %s m × %s m — existing conditions (fixed)</text>',
				self::f( $maxy - $miny + 30 ),
				esc_html( rtrim( rtrim( number_format( $pw, 2 ), '0' ), '.' ) ),
				esc_html( rtrim( rtrim( number_format( $pl, 2 ), '0' ), '.' ) ) );
		}

		$svg .= '</g></svg>';
		return $svg;
	}

	/** Format a float for SVG (trim trailing zeros). */
	private static function f( $n ) {
		return rtrim( rtrim( number_format( (float) $n, 2, '.', '' ), '0' ), '.' );
	}
}

<?php
/**
 * Structured site measurements for a project.
 *
 * Stored as JSON in the projects.measurements column (plus the denormalised
 * plot_width_m / plot_length_m columns for quick access). Captured via the
 * draw-on-plan tool or the manual table on the Capture step, and injected into
 * the plan / render prompts so the AI works to real dimensions.
 *
 * JSON shape:
 *   {
 *     "unit": "m",
 *     "plot": { "w": 6.5, "l": 13.5 },
 *     "zones": [
 *       { "id":"z1", "label":"Main lawn", "type":"lawn", "w":0, "l":0, "area_m2":22,
 *         "rect": { "x":..,"y":..,"w":..,"h":.. } }   // rect optional (canvas geometry)
 *     ],
 *     "scale": { "px_per_m": 12.4 }                    // optional (canvas calibration)
 *   }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Measure {

	/** Allowed zone types. */
	const ZONE_TYPES = array( 'lawn', 'border', 'patio', 'path', 'water', 'structure', 'other' );

	/** Decode a project's measurements into a normalised array (with defaults). */
	public static function get( $project ) {
		$raw = is_array( $project ) && isset( $project['measurements'] ) ? (string) $project['measurements'] : '';
		$data = $raw ? json_decode( $raw, true ) : array();
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		$plot_w = isset( $data['plot']['w'] ) ? (float) $data['plot']['w'] : ( isset( $project['plot_width_m'] ) ? (float) $project['plot_width_m'] : 0 );
		$plot_l = isset( $data['plot']['l'] ) ? (float) $data['plot']['l'] : ( isset( $project['plot_length_m'] ) ? (float) $project['plot_length_m'] : 0 );

		$zones = array();
		if ( ! empty( $data['zones'] ) && is_array( $data['zones'] ) ) {
			foreach ( $data['zones'] as $z ) {
				$zones[] = self::normalise_zone( $z );
			}
		}

		return array(
			'unit'       => 'm',
			'plot'       => array( 'w' => $plot_w, 'l' => $plot_l ),
			'scale_note' => isset( $data['scale_note'] ) ? sanitize_text_field( $data['scale_note'] ) : '',
			'zones'      => array_values( array_filter( $zones ) ),
			'scale'      => isset( $data['scale']['px_per_m'] ) ? array( 'px_per_m' => (float) $data['scale']['px_per_m'] ) : array(),
		);
	}

	/** Clean one zone row to the known shape. */
	private static function normalise_zone( $z ) {
		if ( ! is_array( $z ) ) {
			return null;
		}
		$label = isset( $z['label'] ) ? sanitize_text_field( $z['label'] ) : '';
		$type  = isset( $z['type'] ) && in_array( $z['type'], self::ZONE_TYPES, true ) ? $z['type'] : 'other';
		$w     = isset( $z['w'] ) ? max( 0, (float) $z['w'] ) : 0;
		$l     = isset( $z['l'] ) ? max( 0, (float) $z['l'] ) : 0;
		$area  = isset( $z['area_m2'] ) ? max( 0, (float) $z['area_m2'] ) : 0;
		// If width & length given but no area, compute it.
		if ( $area <= 0 && $w > 0 && $l > 0 ) {
			$area = round( $w * $l, 2 );
		}
		if ( '' === $label && $area <= 0 && $w <= 0 && $l <= 0 ) {
			return null; // empty row
		}
		$zone = array(
			'id'      => isset( $z['id'] ) ? sanitize_key( $z['id'] ) : uniqid( 'z' ),
			'label'   => $label,
			'type'    => $type,
			'w'       => $w,
			'l'       => $l,
			'area_m2' => round( $area, 2 ),
		);
		// Preserve canvas geometry if present so shapes reload.
		if ( isset( $z['rect'] ) && is_array( $z['rect'] ) ) {
			$zone['rect'] = array(
				'x' => (float) ( $z['rect']['x'] ?? 0 ),
				'y' => (float) ( $z['rect']['y'] ?? 0 ),
				'w' => (float) ( $z['rect']['w'] ?? 0 ),
				'h' => (float) ( $z['rect']['h'] ?? 0 ),
			);
		}
		return $zone;
	}

	/**
	 * Validate + persist measurements for a project.
	 *
	 * @param int   $project_id
	 * @param array $data Raw (already wp_unslash'd) data with keys plot{w,l}, zones[], scale.
	 */
	public static function save( $project_id, array $data ) {
		$plot_w = isset( $data['plot']['w'] ) ? max( 0, (float) $data['plot']['w'] ) : 0;
		$plot_l = isset( $data['plot']['l'] ) ? max( 0, (float) $data['plot']['l'] ) : 0;

		$zones = array();
		if ( ! empty( $data['zones'] ) && is_array( $data['zones'] ) ) {
			foreach ( $data['zones'] as $z ) {
				$zone = self::normalise_zone( $z );
				if ( $zone ) {
					$zones[] = $zone;
				}
			}
		}

		$clean = array(
			'unit'       => 'm',
			'plot'       => array( 'w' => round( $plot_w, 2 ), 'l' => round( $plot_l, 2 ) ),
			'scale_note' => isset( $data['scale_note'] ) ? sanitize_text_field( $data['scale_note'] ) : '',
			'zones'      => $zones,
		);
		if ( isset( $data['scale']['px_per_m'] ) && (float) $data['scale']['px_per_m'] > 0 ) {
			$clean['scale'] = array( 'px_per_m' => round( (float) $data['scale']['px_per_m'], 4 ) );
		}

		return HGD_Project::update( $project_id, array(
			'measurements'  => wp_json_encode( $clean ),
			'plot_width_m'  => round( $plot_w, 2 ),
			'plot_length_m' => round( $plot_l, 2 ),
		) );
	}

	public static function plot_area( $project ) {
		$m = self::get( $project );
		return round( (float) $m['plot']['w'] * (float) $m['plot']['l'], 2 );
	}

	public static function total_zone_area( $project ) {
		$m = self::get( $project );
		$t = 0;
		foreach ( $m['zones'] as $z ) {
			$t += (float) $z['area_m2'];
		}
		return round( $t, 2 );
	}

	/** True if the zones add up to more than the plot (a likely measurement error). */
	public static function zones_exceed_plot( $project ) {
		$plot = self::plot_area( $project );
		if ( $plot <= 0 ) {
			return false;
		}
		// Allow a little overlap tolerance.
		return self::total_zone_area( $project ) > ( $plot * 1.05 );
	}

	public static function has_data( $project ) {
		$m = self::get( $project );
		return ( $m['plot']['w'] > 0 && $m['plot']['l'] > 0 ) || ! empty( $m['zones'] );
	}

	/** Compact, AI/human-readable summary injected into plan/render prompts. */
	public static function summary_text( $project ) {
		$m = self::get( $project );
		if ( ! self::has_data( $project ) ) {
			return '';
		}
		$parts = array();
		if ( $m['plot']['w'] > 0 && $m['plot']['l'] > 0 ) {
			$parts[] = sprintf(
				'Plot approximately %s m × %s m (~%s m²).',
				self::num( $m['plot']['w'] ),
				self::num( $m['plot']['l'] ),
				self::num( self::plot_area( $project ) )
			);
		}
		if ( ! empty( $m['zones'] ) ) {
			$bits = array();
			foreach ( $m['zones'] as $z ) {
				$label = '' !== $z['label'] ? $z['label'] : ucfirst( $z['type'] );
				if ( $z['area_m2'] > 0 ) {
					$bits[] = sprintf( '%s ~%s m²', $label, self::num( $z['area_m2'] ) );
				} else {
					$bits[] = $label;
				}
			}
			$parts[] = 'Zones: ' . implode( '; ', $bits ) . '.';
		}
		return implode( ' ', $parts );
	}

	/**
	 * A short factual one-liner for render prompts: plot size + a few key zones.
	 *
	 * @param array $project
	 * @param int   $max_zones How many zones to mention.
	 * @return string
	 */
	public static function render_line( $project, $max_zones = 4 ) {
		$m = self::get( $project );
		if ( ! self::has_data( $project ) ) {
			return '';
		}
		$bits = array();
		if ( $m['plot']['w'] > 0 && $m['plot']['l'] > 0 ) {
			$bits[] = sprintf( 'The plot is approximately %s m × %s m', self::num( $m['plot']['w'] ), self::num( $m['plot']['l'] ) );
		}
		$zone_bits = array();
		foreach ( $m['zones'] as $z ) {
			if ( count( $zone_bits ) >= (int) $max_zones ) {
				break;
			}
			if ( $z['area_m2'] > 0 ) {
				$label = '' !== $z['label'] ? $z['label'] : ucfirst( $z['type'] );
				$zone_bits[] = sprintf( '%s ~%s m²', strtolower( $label ), self::num( $z['area_m2'] ) );
			}
		}
		if ( $zone_bits ) {
			$bits[] = 'key zones: ' . implode( ', ', $zone_bits );
		}
		return $bits ? implode( '; ', $bits ) . '.' : '';
	}

	/**
	 * Suggest a plant quantity for a given zone area, from a plant's
	 * spacing_per_sqm (plants per m²). Light pricing helper — the designer
	 * decides whether to use it; it never auto-edits a quote.
	 *
	 * @param float $area_m2         Zone area in m².
	 * @param float $spacing_per_sqm Plants per square metre.
	 * @return int Suggested whole-plant quantity (0 if either input is unusable).
	 */
	public static function suggest_quantity( $area_m2, $spacing_per_sqm ) {
		$area    = max( 0, (float) $area_m2 );
		$spacing = max( 0, (float) $spacing_per_sqm );
		if ( $area <= 0 || $spacing <= 0 ) {
			return 0;
		}
		return (int) ceil( $area * $spacing );
	}

	private static function num( $n ) {
		$n = (float) $n;
		return rtrim( rtrim( number_format( $n, 2, '.', '' ), '0' ), '.' );
	}

	public static function type_label( $type ) {
		$labels = array(
			'lawn' => 'Lawn', 'border' => 'Border', 'patio' => 'Patio/terrace',
			'path' => 'Path', 'water' => 'Water', 'structure' => 'Structure', 'other' => 'Other',
		);
		return isset( $labels[ $type ] ) ? $labels[ $type ] : ucfirst( (string) $type );
	}
}

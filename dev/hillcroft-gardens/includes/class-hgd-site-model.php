<?php
/**
 * Existing-conditions ("what can't change") layer of a project's site model.
 *
 * The cold-start faithfulness problem: a loose sketch conflates *existing
 * constraints* (the house wall, boundary, a mature tree to keep, a level change)
 * with *design intent* (the new curved path). Fed that ambiguity, the render
 * model invents a random-but-plausible garden. The fix is to capture the fixed
 * reality as structured, human-confirmed data — then render it deterministically
 * (HGD_Base_Plan) into a crisp technical drawing the model can be conditioned on.
 *
 * This layer is stored under the `existing` key of the project's `measurements`
 * JSON (co-located with HGD_Measure's zones, which are the *proposed* design).
 * Everything here is immutable design-wise: it describes what already exists.
 *
 * Shape:
 *   existing: {
 *     boundary: [ { x, y }, … ],                 // plot outline polygon (canvas px)
 *     edges:    [ { treatment }, … ],            // per boundary segment; index-aligned
 *     features: [ { id, kind, retain, cx, cy, r, w, h, notes } ],
 *     orientation: { north_deg, sun_notes }
 *   }
 *   edge treatment ∈ house_wall | fence | wall | hedge | open
 *   feature kind   ∈ tree | structure | level_change | access
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Site_Model {

	const EDGE_TREATMENTS = array( 'house_wall', 'fence', 'wall', 'hedge', 'open' );
	const FEATURE_KINDS   = array( 'tree', 'structure', 'level_change', 'access' );

	/** Read a project's existing-conditions layer (normalised, with defaults). */
	public static function get( $project ) {
		$raw  = is_array( $project ) && isset( $project['measurements'] ) ? (string) $project['measurements'] : '';
		$data = $raw ? json_decode( $raw, true ) : array();
		$ex   = is_array( $data ) && ! empty( $data['existing'] ) ? $data['existing'] : array();
		return self::normalise( is_array( $ex ) ? $ex : array() );
	}

	/** True if any fixed geometry has been captured. */
	public static function has_data( $existing ) {
		return ! empty( $existing['boundary'] ) || ! empty( $existing['features'] );
	}

	/** Coerce raw (AI-proposed or posted) data into the known shape. */
	public static function normalise( $ex ) {
		if ( ! is_array( $ex ) ) {
			$ex = array();
		}

		$boundary = array();
		if ( ! empty( $ex['boundary'] ) && is_array( $ex['boundary'] ) ) {
			foreach ( $ex['boundary'] as $pt ) {
				if ( ! is_array( $pt ) ) {
					continue;
				}
				$boundary[] = array(
					'x' => round( (float) ( $pt['x'] ?? 0 ), 2 ),
					'y' => round( (float) ( $pt['y'] ?? 0 ), 2 ),
				);
			}
		}

		$edges = array();
		if ( ! empty( $ex['edges'] ) && is_array( $ex['edges'] ) ) {
			foreach ( $ex['edges'] as $edge ) {
				$t = is_array( $edge ) ? ( $edge['treatment'] ?? 'open' ) : (string) $edge;
				$edges[] = array( 'treatment' => in_array( $t, self::EDGE_TREATMENTS, true ) ? $t : 'open' );
			}
		}

		$features = array();
		if ( ! empty( $ex['features'] ) && is_array( $ex['features'] ) ) {
			foreach ( $ex['features'] as $f ) {
				if ( ! is_array( $f ) ) {
					continue;
				}
				$kind = isset( $f['kind'] ) && in_array( $f['kind'], self::FEATURE_KINDS, true ) ? $f['kind'] : 'structure';
				$features[] = array(
					'id'    => isset( $f['id'] ) ? sanitize_key( $f['id'] ) : 'f' . substr( md5( wp_json_encode( $f ) ), 0, 6 ),
					'kind'  => $kind,
					'retain'=> isset( $f['retain'] ) ? (bool) $f['retain'] : true,
					'cx'    => round( (float) ( $f['cx'] ?? 0 ), 2 ),
					'cy'    => round( (float) ( $f['cy'] ?? 0 ), 2 ),
					'r'     => round( (float) ( $f['r'] ?? 0 ), 2 ),
					'w'     => round( (float) ( $f['w'] ?? 0 ), 2 ),
					'h'     => round( (float) ( $f['h'] ?? 0 ), 2 ),
					'notes' => sanitize_text_field( (string) ( $f['notes'] ?? '' ) ),
				);
			}
		}

		$north = isset( $ex['orientation']['north_deg'] ) ? (float) $ex['orientation']['north_deg'] : 0;
		// Keep north in [0, 360).
		$north = fmod( fmod( $north, 360 ) + 360, 360 );

		return array(
			'boundary'    => $boundary,
			'edges'       => $edges,
			'features'    => $features,
			'orientation' => array(
				'north_deg' => round( $north, 1 ),
				'sun_notes' => sanitize_text_field( (string) ( $ex['orientation']['sun_notes'] ?? '' ) ),
			),
		);
	}

	/**
	 * Persist the existing-conditions layer into the project's measurements JSON,
	 * preserving the design zones already there.
	 */
	public static function save( $project_id, $existing ) {
		$project = HGD_Project::get( $project_id );
		$data    = $project && ! empty( $project['measurements'] ) ? json_decode( (string) $project['measurements'], true ) : array();
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		$data['existing'] = self::normalise( $existing );
		return HGD_Project::update( $project_id, array( 'measurements' => wp_json_encode( $data ) ) );
	}

	/**
	 * A plain-language constraint block appended to plan/render prompts so the
	 * model treats these as fixed. Complements the deterministic base-plan control
	 * image with an explicit textual "do not change".
	 */
	public static function constraints_text( $project ) {
		$ex = self::get( $project );
		if ( ! self::has_data( $ex ) ) {
			return '';
		}
		$lines = array( 'Existing conditions that MUST be preserved exactly (do not move, remove or redesign):' );

		if ( ! empty( $ex['boundary'] ) ) {
			$lines[] = '- The plot boundary shape and position are fixed.';
		}
		$treatments = array();
		foreach ( $ex['edges'] as $e ) {
			$treatments[ $e['treatment'] ] = true;
		}
		if ( isset( $treatments['house_wall'] ) ) {
			$lines[] = '- The house wall/footprint is fixed; do not build over or alter it.';
		}
		foreach ( array( 'wall' => 'boundary wall', 'fence' => 'fence', 'hedge' => 'hedge' ) as $key => $label ) {
			if ( isset( $treatments[ $key ] ) ) {
				$lines[] = sprintf( '- Retain the existing %s on the marked boundary edge(s).', $label );
			}
		}

		$counts = array();
		foreach ( $ex['features'] as $f ) {
			if ( empty( $f['retain'] ) ) {
				continue;
			}
			$counts[ $f['kind'] ] = ( $counts[ $f['kind'] ] ?? 0 ) + 1;
			if ( '' !== $f['notes'] ) {
				$lines[] = sprintf( '- Retain %s: %s.', str_replace( '_', ' ', $f['kind'] ), $f['notes'] );
			}
		}
		if ( ! empty( $counts['tree'] ) ) {
			$lines[] = sprintf( '- Retain %d existing tree(s) at their marked positions and canopy sizes.', (int) $counts['tree'] );
		}
		if ( ! empty( $counts['level_change'] ) ) {
			$lines[] = '- Preserve the existing change(s) of level/slope.';
		}

		if ( '' !== $ex['orientation']['sun_notes'] ) {
			$lines[] = '- Orientation/sun: ' . $ex['orientation']['sun_notes'] . '.';
		}

		return implode( "\n", $lines );
	}
}

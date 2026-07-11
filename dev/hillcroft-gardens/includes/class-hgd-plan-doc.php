<?php
/**
 * The plan document — a structured, human-editable representation of a garden
 * plan. This is the "perfect model": the plan is DATA + TYPED TEXT, edited by a
 * human and rendered deterministically by code. A generative image model never
 * draws it (that's what produced the garbled, invented plans we're replacing).
 *
 * The AI's only job is a first-pass read (HGD_Plan_Extract) that pre-fills this
 * doc as editable elements; the designer corrects every label and shape in the
 * Konva editor before anything downstream trusts it.
 *
 * Stored under the `plan` key of the project's `measurements` JSON. All geometry
 * uses a shared 0–1000 (x) by 0–750 (y) space so the extractor, the editor and
 * the renderer agree. Seeds itself from the older `existing` layer if present so
 * earlier work isn't lost.
 *
 * Shape:
 *   plan: {
 *     meta:        { title, date },
 *     boundary:    [ {x,y}, … ],                       // plot outline polygon
 *     edges:       [ { treatment }, … ],               // per boundary segment
 *     zones:       [ { id, name, type, fixed, points:[{x,y}] } ],
 *     features:    [ { id, kind, retain, label, cx,cy,r,w,h } ],
 *     dimensions:  [ { id, ax,ay,bx,by, label } ],
 *     annotations: [ { id, kind:'circle'|'note', x,y,r, text } ],
 *     labels:      [ { id, x,y, text } ],
 *     orientation: { north_deg, sun_notes }
 *   }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Plan_Doc {

	const W = 1000;
	const H = 750;

	const EDGE_TREATMENTS = array( 'house_wall', 'wall', 'fence', 'hedge', 'open' );
	const FEATURE_KINDS   = array( 'tree', 'structure', 'level_change', 'access', 'water', 'other' );
	const ZONE_TYPES      = array( 'lawn', 'border', 'patio', 'path', 'water', 'planting', 'structure', 'other' );

	/** Read a project's plan doc (normalised, with defaults). Seeds from `existing`. */
	public static function get( $project ) {
		$raw  = is_array( $project ) && isset( $project['measurements'] ) ? (string) $project['measurements'] : '';
		$data = $raw ? json_decode( $raw, true ) : array();
		$data = is_array( $data ) ? $data : array();

		if ( ! empty( $data['plan'] ) && is_array( $data['plan'] ) ) {
			return self::normalise( $data['plan'] );
		}
		// Seed from the older existing-conditions layer (1.21.0) so nothing is lost.
		if ( ! empty( $data['existing'] ) && is_array( $data['existing'] ) ) {
			return self::normalise( $data['existing'] );
		}
		return self::normalise( array() );
	}

	public static function has_data( $plan ) {
		return ! empty( $plan['boundary'] ) || ! empty( $plan['zones'] ) || ! empty( $plan['features'] );
	}

	/** Coerce raw (AI-proposed or editor-posted) data into the known shape. */
	public static function normalise( $p ) {
		if ( ! is_array( $p ) ) {
			$p = array();
		}

		$boundary = self::points( isset( $p['boundary'] ) ? $p['boundary'] : array() );

		$edges = array();
		if ( ! empty( $p['edges'] ) && is_array( $p['edges'] ) ) {
			foreach ( $p['edges'] as $e ) {
				$t = is_array( $e ) ? ( $e['treatment'] ?? 'open' ) : (string) $e;
				$edges[] = array( 'treatment' => in_array( $t, self::EDGE_TREATMENTS, true ) ? $t : 'open' );
			}
		}

		$zones = array();
		if ( ! empty( $p['zones'] ) && is_array( $p['zones'] ) ) {
			foreach ( $p['zones'] as $z ) {
				if ( ! is_array( $z ) ) {
					continue;
				}
				$pts = self::points( isset( $z['points'] ) ? $z['points'] : array() );
				if ( count( $pts ) < 3 ) {
					continue;
				}
				$type = isset( $z['type'] ) && in_array( $z['type'], self::ZONE_TYPES, true ) ? $z['type'] : 'other';
				$zones[] = array(
					'id'     => self::id( $z, 'z' ),
					'name'   => sanitize_text_field( (string) ( $z['name'] ?? '' ) ),
					'type'   => $type,
					'fixed'  => ! empty( $z['fixed'] ),
					'points' => $pts,
				);
			}
		}

		$features = array();
		if ( ! empty( $p['features'] ) && is_array( $p['features'] ) ) {
			foreach ( $p['features'] as $f ) {
				if ( ! is_array( $f ) ) {
					continue;
				}
				$kind = isset( $f['kind'] ) && in_array( $f['kind'], self::FEATURE_KINDS, true ) ? $f['kind'] : 'other';
				$features[] = array(
					'id'     => self::id( $f, 'f' ),
					'kind'   => $kind,
					'retain' => isset( $f['retain'] ) ? (bool) $f['retain'] : true,
					'label'  => sanitize_text_field( (string) ( $f['label'] ?? '' ) ),
					'cx'     => self::n( $f['cx'] ?? 0 ),
					'cy'     => self::n( $f['cy'] ?? 0 ),
					'r'      => self::n( $f['r'] ?? 0 ),
					'w'      => self::n( $f['w'] ?? 0 ),
					'h'      => self::n( $f['h'] ?? 0 ),
				);
			}
		}

		$dimensions = array();
		if ( ! empty( $p['dimensions'] ) && is_array( $p['dimensions'] ) ) {
			foreach ( $p['dimensions'] as $d ) {
				if ( ! is_array( $d ) ) {
					continue;
				}
				$dimensions[] = array(
					'id'    => self::id( $d, 'd' ),
					'ax'    => self::n( $d['ax'] ?? 0 ), 'ay' => self::n( $d['ay'] ?? 0 ),
					'bx'    => self::n( $d['bx'] ?? 0 ), 'by' => self::n( $d['by'] ?? 0 ),
					'label' => sanitize_text_field( (string) ( $d['label'] ?? '' ) ),
				);
			}
		}

		$annotations = array();
		if ( ! empty( $p['annotations'] ) && is_array( $p['annotations'] ) ) {
			foreach ( $p['annotations'] as $a ) {
				if ( ! is_array( $a ) ) {
					continue;
				}
				$kind = isset( $a['kind'] ) && in_array( $a['kind'], array( 'circle', 'note' ), true ) ? $a['kind'] : 'note';
				$annotations[] = array(
					'id'   => self::id( $a, 'a' ),
					'kind' => $kind,
					'x'    => self::n( $a['x'] ?? 0 ), 'y' => self::n( $a['y'] ?? 0 ),
					'r'    => self::n( $a['r'] ?? 0 ),
					'text' => sanitize_text_field( (string) ( $a['text'] ?? '' ) ),
				);
			}
		}

		$labels = array();
		if ( ! empty( $p['labels'] ) && is_array( $p['labels'] ) ) {
			foreach ( $p['labels'] as $l ) {
				if ( ! is_array( $l ) ) {
					continue;
				}
				$text = sanitize_text_field( (string) ( $l['text'] ?? '' ) );
				if ( '' === $text ) {
					continue;
				}
				$labels[] = array(
					'id'   => self::id( $l, 'l' ),
					'x'    => self::n( $l['x'] ?? 0 ), 'y' => self::n( $l['y'] ?? 0 ),
					'text' => $text,
				);
			}
		}

		$north = isset( $p['orientation']['north_deg'] ) ? (float) $p['orientation']['north_deg'] : 0;
		$north = fmod( fmod( $north, 360 ) + 360, 360 );

		return array(
			'meta' => array(
				'title' => sanitize_text_field( (string) ( $p['meta']['title'] ?? '' ) ),
				'date'  => sanitize_text_field( (string) ( $p['meta']['date'] ?? '' ) ),
			),
			'boundary'    => $boundary,
			'edges'       => $edges,
			'zones'       => $zones,
			'features'    => $features,
			'dimensions'  => $dimensions,
			'annotations' => $annotations,
			'labels'      => $labels,
			'orientation' => array(
				'north_deg' => round( $north, 1 ),
				'sun_notes' => sanitize_text_field( (string) ( $p['orientation']['sun_notes'] ?? '' ) ),
			),
		);
	}

	/** Persist the plan doc into the measurements JSON, preserving zones/existing. */
	public static function save( $project_id, $plan ) {
		$project = HGD_Project::get( $project_id );
		$data    = $project && ! empty( $project['measurements'] ) ? json_decode( (string) $project['measurements'], true ) : array();
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		$data['plan'] = self::normalise( $plan );
		return HGD_Project::update( $project_id, array( 'measurements' => wp_json_encode( $data ) ) );
	}

	/**
	 * Plain-language constraint block for plan/render prompts: the fixed elements
	 * the model must preserve, by their typed labels.
	 */
	public static function constraints_text( $project ) {
		$plan = self::get( $project );
		if ( ! self::has_data( $plan ) ) {
			return '';
		}
		$lines = array( 'Existing conditions that MUST be preserved exactly (do not move, remove or redesign):' );
		if ( ! empty( $plan['boundary'] ) ) {
			$lines[] = '- The plot boundary shape and position are fixed.';
		}
		$treatments = array();
		foreach ( $plan['edges'] as $e ) {
			$treatments[ $e['treatment'] ] = true;
		}
		if ( isset( $treatments['house_wall'] ) ) {
			$lines[] = '- The house wall/footprint is fixed.';
		}
		foreach ( array( 'wall' => 'boundary wall', 'fence' => 'fence', 'hedge' => 'hedge' ) as $k => $label ) {
			if ( isset( $treatments[ $k ] ) ) {
				$lines[] = sprintf( '- Retain the existing %s on the marked edge(s).', $label );
			}
		}
		foreach ( $plan['features'] as $f ) {
			if ( empty( $f['retain'] ) ) {
				continue;
			}
			$name = '' !== $f['label'] ? $f['label'] : str_replace( '_', ' ', $f['kind'] );
			$lines[] = sprintf( '- Retain %s.', $name );
		}
		foreach ( $plan['zones'] as $z ) {
			if ( ! empty( $z['fixed'] ) && '' !== $z['name'] ) {
				$lines[] = sprintf( '- Keep the existing %s.', $z['name'] );
			}
		}
		if ( '' !== $plan['orientation']['sun_notes'] ) {
			$lines[] = '- Orientation/sun: ' . $plan['orientation']['sun_notes'] . '.';
		}
		return implode( "\n", $lines );
	}

	// -- helpers --------------------------------------------------------------

	private static function points( $arr ) {
		$out = array();
		if ( is_array( $arr ) ) {
			foreach ( $arr as $pt ) {
				if ( is_array( $pt ) ) {
					$out[] = array( 'x' => self::n( $pt['x'] ?? 0 ), 'y' => self::n( $pt['y'] ?? 0 ) );
				}
			}
		}
		return $out;
	}

	private static function n( $v ) {
		return round( (float) $v, 1 );
	}

	private static function id( $row, $prefix ) {
		return isset( $row['id'] ) ? sanitize_key( $row['id'] ) : $prefix . substr( md5( wp_json_encode( $row ) . wp_rand() ), 0, 6 );
	}
}

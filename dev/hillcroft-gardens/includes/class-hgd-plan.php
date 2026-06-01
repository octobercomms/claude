<?php
/**
 * Plan-first render pipeline — the garden PLAN drawing.
 *
 * A clean, top-down, scaled landscape PLAN of the garden (architectural /
 * landscape-plan style, NOT a photoreal render), generated from the designer's
 * sketch + Claude's site reading + the design brief. The designer iterates it
 * until the layout is right; the approved plan then becomes the primary
 * structural reference for the concept renders and the render pack — so renders
 * follow the real layout instead of inventing one.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Plan {

	/** Max number of reference images sent to Gemini when generating a plan. */
	const MAX_REFS = 3;

	/**
	 * Build the image-generation prompt for a clean, top-down garden PLAN drawing.
	 *
	 * @param array $project Project row (ARRAY_A) from HGD_Project::get().
	 * @return string
	 */
	public static function compose_plan_prompt( $project ) {
		$project = is_array( $project ) ? $project : array();

		$reading = isset( $project['ai_reading'] ) ? trim( (string) $project['ai_reading'] ) : '';
		$brief   = isset( $project['design_brief'] ) ? trim( (string) $project['design_brief'] ) : '';
		$style   = isset( $project['style_prefs'] ) ? trim( (string) $project['style_prefs'] ) : '';
		$address = isset( $project['address'] ) ? trim( (string) $project['address'] ) : '';
		$postcode = isset( $project['postcode'] ) ? trim( (string) $project['postcode'] ) : '';

		$aesthetic = 'Produce a clean, top-down, scaled GARDEN PLAN drawing in an architectural / landscape-plan style — '
			. 'a crisp bird\'s-eye orthographic plan view as if looking straight down from directly above (NOT a perspective or photoreal render). '
			. 'Use a precise but hand-crafted ink-and-wash aesthetic — confident hand-drawn-but-accurate ink linework with soft watercolour washes on a clean white background. '
			. 'Include a north arrow, an approximate scale indication, clearly labelled zones (lawn, planting borders/beds, patio/terrace, paths, steps, '
			. 'and structures such as shed, pergola, greenhouse), crisp bed outlines, and simple plant-massing blobs with a small light legend. '
			. 'Keep it legible, calm and presentation-friendly — it must read as a designer\'s plan, not a technical CAD drawing.';

		$honour = 'IMPORTANT: honour the real dimensions, proportions and layout described in the site reading and brief below. '
			. 'Lay out every zone in its correct relative position and keep all fixed/existing features — boundaries (walls, fences, hedges), '
			. 'existing trees and established planting, levels, the house and any structures — exactly where the site reading places them. '
			. 'This plan must match the actual plot, not an invented one.';

		$parts = array();
		$parts[] = $aesthetic;
		$parts[] = $honour;

		$context = "SITE READING (existing garden, dimensions and features):\n" . ( '' !== $reading ? $reading : '(none)' );
		$parts[] = $context;

		if ( '' !== $brief ) {
			$parts[] = "DESIGN BRIEF (the intended scheme to lay out in plan):\n" . $brief;
		}
		if ( '' !== $style ) {
			$parts[] = 'Style preferences: ' . $style;
		}
		if ( '' !== $address || '' !== $postcode ) {
			$parts[] = 'Location: ' . trim( $address . ' ' . $postcode );
		}

		return implode( "\n\n", $parts );
	}

	/**
	 * Reference attachment ids used to BUILD the plan: the project's sketch(es)
	 * first, topped up with photos. Capped at self::MAX_REFS (sketch first), so
	 * the plan is generated FROM the real consultation drawing.
	 *
	 * @param int $project_id
	 * @return int[]
	 */
	public static function reference_ids_for( $project_id ) {
		$project_id = (int) $project_id;
		$ids        = array();

		foreach ( HGD_Project_Asset::for_project( $project_id, 'sketch' ) as $sketch ) {
			if ( ! empty( $sketch['attachment_id'] ) ) {
				$ids[] = (int) $sketch['attachment_id'];
			}
		}
		foreach ( HGD_Project_Asset::for_project( $project_id, 'photo' ) as $photo ) {
			if ( ! empty( $photo['attachment_id'] ) ) {
				$ids[] = (int) $photo['attachment_id'];
			}
		}

		return array_slice( array_values( array_unique( array_map( 'intval', $ids ) ) ), 0, self::MAX_REFS );
	}

	/**
	 * The most recent approved 'plan' attachment id for a project, or 0.
	 *
	 * @param int $project_id
	 * @return int
	 */
	public static function latest_plan_attachment_id( $project_id ) {
		$plans = HGD_Project_Asset::for_project( (int) $project_id, 'plan' );
		if ( empty( $plans ) ) {
			return 0;
		}
		// for_project() returns oldest first — take the most recent.
		$latest = end( $plans );
		return ! empty( $latest['attachment_id'] ) ? (int) $latest['attachment_id'] : 0;
	}
}

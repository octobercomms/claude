<?php
/**
 * First-pass vision read of a sketch into an editable plan doc (HGD_Plan_Doc).
 *
 * This ONLY proposes. The read is expected to be imperfect — the handwriting is
 * often barely legible — so every shape and label lands in the editor as
 * editable text/geometry, and the designer corrects it before anything trusts
 * it. That's the whole point: the model transcribes, the human verifies.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Plan_Extract {

	/**
	 * @return array|WP_Error normalised plan doc (HGD_Plan_Doc shape).
	 */
	public static function propose( $project_id ) {
		if ( ! HGD_Claude::is_configured() ) {
			return new WP_Error( 'hgd_plan_no_claude', __( 'Claude is not configured; add an API key in Settings to read the sketch.', 'hillcroft-garden-designer' ) );
		}
		$project = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_plan_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}

		$sketches = HGD_Project_Asset::for_project( $project_id, 'sketch' );
		$photos   = HGD_Project_Asset::for_project( $project_id, 'photo' );
		if ( empty( $sketches ) && empty( $photos ) ) {
			return new WP_Error( 'hgd_plan_no_input', __( 'Upload the sketch (and any site photos) first.', 'hillcroft-garden-designer' ) );
		}

		$blocks   = array( HGD_Claude::text_block( self::instructions( $project ) ) );
		$added    = 0;
		foreach ( $sketches as $s ) {
			$img = HGD_Claude::image_block_from_attachment( (int) $s['attachment_id'] );
			if ( $img ) {
				$blocks[] = HGD_Claude::text_block( 'DESIGN SKETCH (transcribe the layout, dimensions and every written label from this):' );
				$blocks[] = $img;
				$added++;
			}
			if ( $added >= 4 ) { break; }
		}
		foreach ( $photos as $p ) {
			$img = HGD_Claude::image_block_from_attachment( (int) $p['attachment_id'] );
			if ( $img ) {
				$blocks[] = HGD_Claude::text_block( 'SITE PHOTO (context for what physically exists):' );
				$blocks[] = $img;
				$added++;
			}
			if ( $added >= 7 ) { break; }
		}
		if ( 0 === $added ) {
			return new WP_Error( 'hgd_plan_no_images', __( 'Could not read the uploaded images.', 'hillcroft-garden-designer' ) );
		}

		$res = HGD_Claude::message( $blocks, self::system_prompt(), 4000, $project_id );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$parsed = self::parse_json( (string) $res['text'] );
		if ( null === $parsed ) {
			HGD_Log::warning( 'plan.extract', 'could not parse JSON from vision response', array( 'project_id' => (int) $project_id ) );
			return new WP_Error( 'hgd_plan_parse', __( 'Could not interpret the sketch. Try again, or draw it by hand.', 'hillcroft-garden-designer' ) );
		}
		return HGD_Plan_Doc::normalise( $parsed );
	}

	private static function system_prompt() {
		return 'You are a landscape architect digitising a hand-drawn garden sketch into a clean, editable plan. Transcribe faithfully — copy the real written labels and dimensions; do not invent a design of your own. Respond with a single minified JSON object and nothing else.';
	}

	private static function instructions( $project ) {
		$measure = class_exists( 'HGD_Measure' ) ? HGD_Measure::get( $project ) : array( 'plot' => array( 'w' => 0, 'l' => 0 ) );
		$dims    = '';
		if ( ! empty( $measure['plot']['w'] ) && ! empty( $measure['plot']['l'] ) ) {
			$dims = sprintf( "Known plot size: about %s m by %s m.\n", $measure['plot']['w'], $measure['plot']['l'] );
		}
		$w = HGD_Plan_Doc::W;
		$h = HGD_Plan_Doc::H;

		return
			"Transcribe this garden sketch into a structured plan. Match the sketch's LAYOUT, PROPORTIONS and ORIENTATION — this is a faithful digitisation, not a new design.\n" .
			$dims .
			"Coordinate space: 0 to {$w} on X, 0 to {$h} on Y, origin TOP-LEFT, matching the sketch as drawn (keep its aspect ratio and which way is up).\n\n" .
			"Return JSON with these keys:\n" .
			'{"meta":{"title":"","date":""},' .
			'"boundary":[{"x":int,"y":int},...],' .
			'"edges":[{"treatment":"house_wall|wall|fence|hedge|open"},...],' .
			'"zones":[{"name":"","type":"lawn|border|patio|path|water|planting|structure|other","fixed":bool,"points":[{"x":int,"y":int},...]}],' .
			'"features":[{"kind":"tree|structure|level_change|access|water|other","retain":bool,"label":"","cx":int,"cy":int,"r":int,"w":int,"h":int}],' .
			'"dimensions":[{"ax":int,"ay":int,"bx":int,"by":int,"label":"6.5m"}],' .
			'"annotations":[{"kind":"circle|note","x":int,"y":int,"r":int,"text":""}],' .
			'"labels":[{"x":int,"y":int,"text":""}],' .
			'"orientation":{"north_deg":int,"sun_notes":""}}' . "\n\n" .
			"Rules:\n" .
			"- boundary: the plot outline polygon, points in order.\n" .
			"- edges: one per boundary segment (segment i = point i to i+1), same order; mark house walls, retaining walls, fences, hedges.\n" .
			"- zones: named areas drawn on the sketch (lawn, borders, patio, paths, raised beds, etc.) as polygons. Set fixed=true if it's existing and being kept.\n" .
			"- features: point items — trees (give canopy radius r), sheds/containers/structures (w,h), level changes, gates/access, water. Put the sketch's own words in label.\n" .
			"- dimensions: every measurement written on the sketch, as a line between the two points it spans with the exact text (e.g. \"6.5m\", \"11.5m\", \"0.75m\").\n" .
			"- labels/annotations: copy EVERY other piece of writing verbatim (notes, keys, callouts, arrows). If a note points at a spot, use an annotation; otherwise a label.\n" .
			"- Transcribe text exactly as written even if unsure; the designer will fix misreads. Do not omit writing because it's hard to read.\n" .
			"- Output ONLY the JSON object.";
	}

	private static function parse_json( $text ) {
		$text  = trim( (string) $text );
		$text  = preg_replace( '/^```(?:json)?\s*|\s*```$/m', '', $text );
		$start = strpos( $text, '{' );
		$end   = strrpos( $text, '}' );
		if ( false === $start || false === $end || $end <= $start ) {
			return null;
		}
		$data = json_decode( substr( $text, $start, $end - $start + 1 ), true );
		return is_array( $data ) ? $data : null;
	}
}

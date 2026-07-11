<?php
/**
 * Vision extraction of the existing-conditions layer.
 *
 * Uses Claude vision to *propose* the fixed geometry (boundary, edges, retained
 * features, orientation) from the uploaded sketch + site photos + measurements.
 * This is only a proposal — extraction is the unreliable step, so Donna confirms
 * and corrects it on the editor canvas before it's trusted (never unattended).
 *
 * All coordinates use a shared 0–1000 space (top-left origin) so the extractor,
 * the confirm editor and the deterministic base-plan renderer all agree.
 *
 * IMPORTANT distinction fed to the model: site *photos* are ground truth for
 * what physically exists; the *sketch* is design intent. We ask it to derive the
 * fixed layer from what exists, not from the proposed design lines.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Existing_Extract {

	const COORD_SPACE = 1000;

	/**
	 * Propose the existing-conditions layer for a project.
	 *
	 * @return array|WP_Error normalised existing layer (HGD_Site_Model shape).
	 */
	public static function propose( $project_id ) {
		if ( ! HGD_Claude::is_configured() ) {
			return new WP_Error( 'hgd_extract_no_claude', __( 'Claude is not configured; add an API key in Settings to auto-detect existing conditions.', 'hillcroft-garden-designer' ) );
		}
		$project = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_extract_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}

		$sketches = HGD_Project_Asset::for_project( $project_id, 'sketch' );
		$photos   = HGD_Project_Asset::for_project( $project_id, 'photo' );
		if ( empty( $sketches ) && empty( $photos ) ) {
			return new WP_Error( 'hgd_extract_no_input', __( 'Upload a sketch or site photos first so the existing conditions can be detected.', 'hillcroft-garden-designer' ) );
		}

		$blocks = array();
		$blocks[] = HGD_Claude::text_block( self::instructions( $project ) );

		// Photos first (ground truth), then sketches (design intent), each labelled.
		$added = 0;
		foreach ( $photos as $p ) {
			$img = HGD_Claude::image_block_from_attachment( (int) $p['attachment_id'] );
			if ( $img ) {
				$blocks[] = HGD_Claude::text_block( 'SITE PHOTO (ground truth for what exists):' );
				$blocks[] = $img;
				$added++;
			}
			if ( $added >= 4 ) { break; }
		}
		foreach ( $sketches as $s ) {
			$img = HGD_Claude::image_block_from_attachment( (int) $s['attachment_id'] );
			if ( $img ) {
				$blocks[] = HGD_Claude::text_block( 'DESIGN SKETCH (design intent — use only to locate the plot outline and fixed elements, not to copy proposed design lines):' );
				$blocks[] = $img;
				$added++;
			}
			if ( $added >= 6 ) { break; }
		}
		if ( 0 === $added ) {
			return new WP_Error( 'hgd_extract_no_images', __( 'Could not read the uploaded images.', 'hillcroft-garden-designer' ) );
		}

		$res = HGD_Claude::message( $blocks, self::system_prompt(), 2000, $project_id );
		if ( is_wp_error( $res ) ) {
			return $res;
		}

		$parsed = self::parse_json( (string) $res['text'] );
		if ( null === $parsed ) {
			HGD_Log::warning( 'existing.extract', 'could not parse JSON from vision response', array( 'project_id' => (int) $project_id ) );
			return new WP_Error( 'hgd_extract_parse', __( 'Could not interpret the detected conditions. Try again, or place them by hand.', 'hillcroft-garden-designer' ) );
		}

		return HGD_Site_Model::normalise( $parsed );
	}

	private static function system_prompt() {
		return 'You are a landscape surveyor. From the supplied garden photos and sketch, identify only the EXISTING, FIXED conditions of the plot — never the proposed design. Respond with a single minified JSON object and nothing else.';
	}

	private static function instructions( $project ) {
		$measure = class_exists( 'HGD_Measure' ) ? HGD_Measure::get( $project ) : array( 'plot' => array( 'w' => 0, 'l' => 0 ) );
		$dims    = '';
		if ( ! empty( $measure['plot']['w'] ) && ! empty( $measure['plot']['l'] ) ) {
			$dims = sprintf( "The plot measures approximately %s m wide by %s m long.\n", $measure['plot']['w'], $measure['plot']['l'] );
		}

		return
			"Identify the existing conditions of this garden that CANNOT change and must be preserved in any new design.\n" .
			$dims .
			"Use a coordinate space of 0 to " . self::COORD_SPACE . " on both axes, origin at the TOP-LEFT of the plot as drawn in the sketch.\n\n" .
			"Return JSON with exactly these keys:\n" .
			'{"boundary":[{"x":int,"y":int},...],' .
			'"edges":[{"treatment":"house_wall|wall|fence|hedge|open"},...],' .
			'"features":[{"kind":"tree|structure|level_change|access","retain":true,"cx":int,"cy":int,"r":int,"w":int,"h":int,"notes":"short"}],' .
			'"orientation":{"north_deg":int,"sun_notes":"short"}}' . "\n\n" .
			"Rules:\n" .
			"- boundary: the plot outline as a closed polygon, points in order.\n" .
			"- edges: one entry per boundary segment, in the same order as boundary points (segment i connects point i to point i+1). Mark which edge is the house wall.\n" .
			"- features: existing things to KEEP — mature trees (give canopy radius r), sheds/walls/patios to retain (give w/h), changes of level, and access/gates. Omit anything that is clearly part of the proposed new design.\n" .
			"- If unsure about a value use 0. Do not invent features that aren't visible.\n" .
			"- Output ONLY the JSON object.";
	}

	/** Pull the first JSON object out of a model response (tolerates code fences / prose). */
	private static function parse_json( $text ) {
		$text = trim( $text );
		// Strip ```json fences if present.
		$text = preg_replace( '/^```(?:json)?\s*|\s*```$/m', '', $text );
		$start = strpos( $text, '{' );
		$end   = strrpos( $text, '}' );
		if ( false === $start || false === $end || $end <= $start ) {
			return null;
		}
		$json = substr( $text, $start, $end - $start + 1 );
		$data = json_decode( $json, true );
		return is_array( $data ) ? $data : null;
	}
}

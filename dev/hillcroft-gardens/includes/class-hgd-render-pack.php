<?php
/**
 * Render pack — a deliberate, named SET of garden views generated from the
 * approved concept render, for use in the proposal / client portal.
 *
 * Each view is a fresh Gemini generation, anchored to the latest concept render
 * (the "consistency anchor") so every image shows the SAME garden — same layout,
 * planting and materials — from a different viewpoint or in a different season.
 * Generations cost money, so they only ever run on an explicit admin action.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Render_Pack {

	/** Default season for one-off / "full pack" generations. */
	const DEFAULT_SEASON = 'summer';

	/**
	 * The deliberate set of named views, in display order.
	 *
	 * 'masterplan' and 'satellite' are the two top-down views: 'satellite' is a
	 * real Google aerial photo of the actual plot (see HGD_Maps); 'masterplan' is
	 * a Gemini-rendered aerial of the *designed* scheme, anchored to the concept.
	 *
	 * @var array<string,array{label:string,prompt_suffix:string}>
	 */
	const VIEWS = array(
		'masterplan'    => array(
			'label'         => 'Masterplan (aerial)',
			'prompt_suffix' => 'Render an aerial / top-down masterplan view of the whole garden, as if looking straight down from directly above, showing the full layout — every bed, path, lawn and seating area in plan. Keep proportions and positions true to the design.',
		),
		'watercolour'   => array(
			'label'         => 'Watercolour impression',
			'prompt_suffix' => 'Render the garden scheme as a loose, elegant watercolour painting — an artist\'s impression with soft washes and confident brushwork. This is the hero / cover image, so make it beautiful and inviting while staying true to the design.',
		),
		'plan_handdrawn' => array(
			'label'         => 'Hand-drawn plan',
			'prompt_suffix' => 'Render an illustrative, hand-drawn garden plan in ink-and-wash, with labelled zones, that looks sketched by a designer\'s hand. It must NOT look like a technical CAD drawing — keep it warm, hand-crafted and presentation-friendly.',
		),
		'corner_patio'  => array(
			'label'         => 'Patio / seating area',
			'prompt_suffix' => 'Render an eye-level, photorealistic view of the patio / main seating area, as a person would see it standing in the garden.',
		),
		'corner_border' => array(
			'label'         => 'Main planting border',
			'prompt_suffix' => 'Render an eye-level, photorealistic view of the main planting border in full growth, as a person would see it standing in the garden.',
		),
		'corner_focal'  => array(
			'label'         => 'Focal point / feature',
			'prompt_suffix' => 'Render an eye-level, photorealistic view of the garden\'s focal point / key feature, as a person would see it standing in the garden.',
		),
		'elevation_rear' => array(
			'label'         => 'Elevation — rear boundary',
			'prompt_suffix' => 'Draw a scaled ELEVATION (a straight-on, head-on orthographic side view, NOT a perspective) of the garden looking square at the rear boundary — showing the back fence/wall, the planting in front of it drawn at true relative heights, and any structures (shed, pergola) in flat elevation. Architectural landscape-elevation style: clean, measured, ink-and-light-wash on white, with a simple height scale. It is a design guide, not a photo.',
		),
		'elevation_side' => array(
			'label'         => 'Elevation — side boundary',
			'prompt_suffix' => 'Draw a scaled ELEVATION (a straight-on, head-on orthographic side view, NOT a perspective) looking square at one side boundary of the garden — showing levels/steps, the side fence, and planting drawn at true relative heights along its length. Architectural landscape-elevation style: clean, measured, ink-and-light-wash on white, with a simple height scale. It is a design guide, not a photo.',
		),
	);

	/**
	 * Seasonal mood fragments appended to the prompt.
	 *
	 * @var array<string,string>
	 */
	const SEASONS = array(
		'spring' => 'spring season — fresh growth, blossom, bulbs, bright new green foliage and soft spring light',
		'summer' => 'summer season — borders in full bloom, lush growth, warm sunny daylight',
		'autumn' => 'autumn season — turning foliage, seed heads, golden low light and rich autumnal tones',
		'winter' => 'winter season — winter structure, bare stems, evergreen bones, frost and crisp cool light',
	);

	/** Human label for a view key. */
	public static function view_label( $view_key ) {
		$view_key = (string) $view_key;
		if ( isset( self::VIEWS[ $view_key ]['label'] ) ) {
			return self::VIEWS[ $view_key ]['label'];
		}
		if ( 'satellite' === $view_key ) {
			return __( 'Satellite view', 'hillcroft-garden-designer' );
		}
		return ucwords( str_replace( '_', ' ', $view_key ) );
	}

	/** Human label for a season key. */
	public static function season_label( $season ) {
		$season = (string) $season;
		return isset( self::SEASONS[ $season ] ) ? ucfirst( $season ) : ucfirst( $season );
	}

	/**
	 * Build the full image-generation prompt for one view + season.
	 *
	 * @param array  $project  Project row (ARRAY_A) from HGD_Project::get().
	 * @param string $view_key One of self::VIEWS.
	 * @param string $season   One of self::SEASONS.
	 * @return string
	 */
	public static function compose_prompt( $project, $view_key, $season = self::DEFAULT_SEASON ) {
		$project = is_array( $project ) ? $project : array();
		$view_key = isset( self::VIEWS[ $view_key ] ) ? $view_key : 'watercolour';
		$season   = isset( self::SEASONS[ $season ] ) ? $season : self::DEFAULT_SEASON;

		$base = isset( $project['render_prompt'] ) ? trim( (string) $project['render_prompt'] ) : '';
		if ( '' === $base ) {
			$base = isset( $project['design_brief'] ) ? trim( (string) $project['design_brief'] ) : '';
		}
		if ( '' === $base ) {
			$base = 'A beautifully designed residential garden with lush planting and well-considered materials.';
		}

		$suffix = self::VIEWS[ $view_key ]['prompt_suffix'];
		$season_fragment = self::SEASONS[ $season ];

		// The eye-level corner views follow the chosen render style (e.g. watercolour).
		// The masterplan / watercolour / hand-drawn-plan views keep their own fixed look.
		$style = '';
		if ( in_array( $view_key, array( 'corner_patio', 'corner_border', 'corner_focal' ), true ) ) {
			$style = "\n\n" . HGD_Settings::render_style_suffix();
		}

		// Consistency clause — the heart of keeping the pack coherent with the
		// approved concept. The reference image carries the actual look; this wording
		// instructs the model to preserve it across viewpoint / season changes.
		$consistency = 'IMPORTANT: keep the same garden layout, planting palette, hard-landscaping and materials as the reference image. '
			. 'It is the same garden and the same design — only the viewpoint and/or season change. '
			. 'Keep fixed features (boundaries, structures, paths, key plants) consistent with the reference.';

		return $base . "\n\n" . $suffix . "\n\n"
			. 'Depict the garden in ' . $season_fragment . ".\n\n"
			. $consistency . $style;
	}

	/**
	 * The structural / consistency anchor: reference attachment ids for Gemini.
	 *
	 * Priority (plan-first pipeline): the most recent approved 'plan' drawing
	 * FIRST (the true layout reference), then the most recent concept 'render',
	 * then the project sketch as a last resort. Returns up to two ids, plan first.
	 *
	 * @param int $project_id
	 * @return int[]
	 */
	public static function reference_ids_for( $project_id ) {
		$project_id = (int) $project_id;
		$ids = array();

		// 1) Approved plan first — it carries the real, agreed layout.
		$plans = HGD_Project_Asset::for_project( $project_id, 'plan' );
		if ( ! empty( $plans ) ) {
			$latest = end( $plans ); // for_project() returns oldest first.
			if ( ! empty( $latest['attachment_id'] ) ) {
				$ids[] = (int) $latest['attachment_id'];
			}
		}

		// 2) Most recent concept render — carries the agreed look.
		$renders = HGD_Project_Asset::for_project( $project_id, 'render' );
		if ( ! empty( $renders ) ) {
			$latest = end( $renders );
			if ( ! empty( $latest['attachment_id'] ) ) {
				$ids[] = (int) $latest['attachment_id'];
			}
		}

		// 3) Fall back to the sketch only if we still have nothing.
		if ( empty( $ids ) ) {
			$sketches = HGD_Project_Asset::for_project( $project_id, 'sketch' );
			foreach ( array_slice( $sketches, 0, 2 ) as $sketch ) {
				if ( ! empty( $sketch['attachment_id'] ) ) {
					$ids[] = (int) $sketch['attachment_id'];
				}
			}
		}

		return array_slice( array_values( array_unique( array_map( 'intval', $ids ) ) ), 0, 2 );
	}

	/**
	 * Does a pack view (view_key + season) already exist for this project?
	 *
	 * Summer is the implicit default, so a label may or may not carry the season.
	 * We match on the stored label, which is how generate_view() encodes the pair.
	 *
	 * @param int    $project_id
	 * @param string $view_key
	 * @param string $season
	 * @return bool
	 */
	public static function view_exists( $project_id, $view_key, $season = self::DEFAULT_SEASON ) {
		$target = self::label_for( $view_key, $season );
		foreach ( HGD_Project_Asset::for_project( (int) $project_id, 'pack' ) as $row ) {
			if ( isset( $row['view_key'] ) && $row['view_key'] === sanitize_key( $view_key )
				&& isset( $row['label'] ) && $row['label'] === $target ) {
				return true;
			}
		}
		return false;
	}

	/** Compose the stored label for a view + season (season shown only when not summer). */
	public static function label_for( $view_key, $season = self::DEFAULT_SEASON ) {
		$label = self::view_label( $view_key );
		if ( $season && self::DEFAULT_SEASON !== $season && isset( self::SEASONS[ $season ] ) ) {
			$label .= ' — ' . self::season_label( $season );
		}
		return $label;
	}

	/**
	 * Generate one pack view and link it to the project.
	 *
	 * @param int    $project_id
	 * @param string $view_key
	 * @param string $season
	 * @param int[]  $reference_attachment_ids Optional explicit anchor ids; if empty, reference_ids_for() is used.
	 * @return int|WP_Error Asset row id on success, WP_Error otherwise.
	 */
	public static function generate_view( $project_id, $view_key, $season = self::DEFAULT_SEASON, $reference_attachment_ids = array() ) {
		$project_id = (int) $project_id;
		$project    = HGD_Project::get( $project_id );
		if ( ! $project ) {
			return new WP_Error( 'hgd_pack_no_project', __( 'Project not found.', 'hillcroft-garden-designer' ) );
		}
		if ( ! isset( self::VIEWS[ $view_key ] ) ) {
			return new WP_Error( 'hgd_pack_bad_view', __( 'Unknown render-pack view.', 'hillcroft-garden-designer' ) );
		}
		if ( ! isset( self::SEASONS[ $season ] ) ) {
			$season = self::DEFAULT_SEASON;
		}

		$refs = ! empty( $reference_attachment_ids ) ? array_map( 'intval', (array) $reference_attachment_ids ) : self::reference_ids_for( $project_id );

		$prompt = self::compose_prompt( $project, $view_key, $season );
		$result = HGD_Gemini::generate_image( $prompt, $refs, $project_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $project_id, 'pack-' . $view_key );
		if ( is_wp_error( $att_id ) ) {
			return $att_id;
		}

		$label   = self::label_for( $view_key, $season );
		$asset_id = HGD_Project_Asset::add( $project_id, $att_id, 'pack', $view_key, $label );

		return (int) $asset_id;
	}

	/**
	 * The 'pack' assets for a project, ordered by the VIEWS order, then season,
	 * with the real satellite view last. Each row keeps its DB fields plus a
	 * resolved 'pack_label'.
	 *
	 * @param int $project_id
	 * @return array[] Asset rows (ARRAY_A) in display order.
	 */
	public static function pack_for_project( $project_id ) {
		$rows = HGD_Project_Asset::for_project( (int) $project_id, 'pack' );
		if ( empty( $rows ) ) {
			return array();
		}

		// Ordering weight by view key.
		$order = array_keys( self::VIEWS );
		$weight = array();
		foreach ( $order as $i => $vk ) {
			$weight[ $vk ] = $i;
		}
		$weight['satellite'] = count( $order ) + 1; // satellite shown last.

		$season_order = array_flip( array_keys( self::SEASONS ) );

		usort( $rows, function ( $a, $b ) use ( $weight, $season_order ) {
			$va = isset( $a['view_key'] ) ? (string) $a['view_key'] : '';
			$vb = isset( $b['view_key'] ) ? (string) $b['view_key'] : '';
			$wa = isset( $weight[ $va ] ) ? $weight[ $va ] : 999;
			$wb = isset( $weight[ $vb ] ) ? $weight[ $vb ] : 999;
			if ( $wa !== $wb ) {
				return $wa - $wb;
			}
			// Same view: keep stable by id (which roughly follows season generation order).
			return (int) $a['id'] - (int) $b['id'];
		} );

		foreach ( $rows as &$row ) {
			$label = isset( $row['label'] ) ? (string) $row['label'] : '';
			$row['pack_label'] = '' !== $label ? $label : self::view_label( isset( $row['view_key'] ) ? $row['view_key'] : '' );
		}
		unset( $row );

		return $rows;
	}
}

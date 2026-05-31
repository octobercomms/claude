<?php
/**
 * Example-project seeder ("Create example project").
 *
 * Spins up a complete, realistic demo project in one click so Donna can explore
 * the whole journey (capture → design → render pack → quote → proposal) before
 * doing a real one. Everything is local: text is hardcoded-realistic and images
 * are GD-generated branded placeholders. NO external API calls (Claude / Gemini /
 * Maps), zero cost.
 *
 * Cleanup is exact: every id the demo creates is tracked in the hgd_demo_ids
 * option so remove() only ever deletes its own data (never a catalogue plant that
 * already existed, never unrelated projects/clients).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Demo {

	/** Identifiable markers for the demo content. */
	const EXAMPLE_FLAG   = 'hgd_demo_ids';
	const EXAMPLE_EMAIL  = 'example@hillcroftgardens.example';
	const TITLE_PREFIX   = '[Example] ';

	// -------------------------------------------------------------------------
	// State helpers
	// -------------------------------------------------------------------------

	/** Stored ids of everything the demo created (or an empty skeleton). */
	private static function ids() {
		$ids = get_option( self::EXAMPLE_FLAG, array() );
		if ( ! is_array( $ids ) ) {
			$ids = array();
		}
		return wp_parse_args( $ids, array(
			'project_id'     => 0,
			'client_id'      => 0,
			'plant_ids'      => array(),
			'attachment_ids' => array(),
		) );
	}

	/** The demo project id, or 0 if none recorded. */
	public static function project_id() {
		$ids = self::ids();
		return (int) $ids['project_id'];
	}

	/** True when a tracked demo project still exists in the database. */
	public static function exists() {
		$pid = self::project_id();
		if ( ! $pid ) {
			return false;
		}
		return null !== HGD_Project::get( $pid );
	}

	/** True when the given project id is the demo project. */
	public static function is_example_project( $project_id ) {
		$pid = self::project_id();
		return $pid && (int) $project_id === $pid;
	}

	// -------------------------------------------------------------------------
	// Create
	// -------------------------------------------------------------------------

	/**
	 * Build the example project. Idempotent: if it already exists, returns the
	 * existing project id without creating anything new.
	 *
	 * @return int Project id.
	 */
	public static function create() {
		if ( self::exists() ) {
			return self::project_id();
		}

		$ids = array(
			'project_id'     => 0,
			'client_id'      => 0,
			'plant_ids'      => array(),
			'attachment_ids' => array(),
		);

		// --- Client -----------------------------------------------------------
		$existing_client = HGD_Client::find_by_email( self::EXAMPLE_EMAIL );
		if ( $existing_client ) {
			$ids['client_id'] = (int) $existing_client['id'];
		} else {
			$ids['client_id'] = HGD_Client::insert( array(
				'first_name'    => 'Meli',
				'last_name'     => 'Example',
				'email'         => self::EXAMPLE_EMAIL,
				'phone'         => '01923 000000',
				'address_line1' => '14 Hillcroft Avenue',
				'address_line2' => '',
				'city'          => 'Watford',
				'postcode'      => 'WD17 4XX',
				'notes'         => 'Example client created by the demo seeder. Safe to remove from the Projects list.',
			) );
		}

		// --- Plants (only insert ones not already present) ---------------------
		$ids['plant_ids'] = self::ensure_demo_plants();

		// --- Project -----------------------------------------------------------
		$project_id = HGD_Project::insert( array(
			'client_id'    => $ids['client_id'],
			'title'        => self::TITLE_PREFIX . "Meli's Garden, Watford",
			'status'       => 'design',
			'source'       => 'manual',
			'address'      => '14 Hillcroft Avenue, Watford',
			'postcode'     => 'WD17 4XX',
			'budget_range' => '£12k–£18k',
			'style_prefs'  => 'naturalistic, pollinator-friendly, year-round structure',
			'has_pets'     => 1,
			'has_children' => 0,
			'brief_notes'  => "South-facing rear garden, roughly rectangular, currently a tired lawn with a narrow border down one side and a small patio by the back door. Meli wants a softer, more naturalistic feel with year-round interest, plenty for pollinators, and a relaxed seating spot to catch the afternoon sun. Low-maintenance where possible. One dog (friendly, digs occasionally), no children. Keen on grasses and a muted, calm colour palette — purples, soft yellows, silvers. Would like the existing silver birch kept.",
		) );
		$ids['project_id'] = (int) $project_id;

		// Rich, AI-style fields written directly (no API call).
		$questions = array(
			'Can we confirm the lawn dimensions — does roughly 11.5m × 6.5m look right against your tape measure?',
			'Is the small patio by the back door staying, or would you like it relocated to the sunnier far corner?',
			'The silver birch is marked to keep — are there any other existing shrubs you definitely want to retain?',
		);

		HGD_Project::update( $project_id, array(
			'ai_reading'   => 'The sketch shows a south-facing rear garden, roughly rectangular. The main lawn measures approximately 11.5m × 6.5m, with a single planting border down the eastern boundary at about 1m depth running the full length. A small existing patio (approx 3m × 3m) sits immediately outside the back door on the north edge. An existing silver birch is marked toward the rear-left corner and annotated "keep". The rear (south) boundary is a 1.8m close-board fence; the side boundaries are mixed fence and a low brick wall on the western side. A hand-written note reads "afternoon sun far corner" against the south-west corner, and "boggy?" near the downpipe by the patio. Access is via a side gate, approx 0.9m wide, on the western boundary.',
			'ai_questions' => wp_json_encode( $questions ),
			'design_brief' => "A calm, naturalistic scheme that reframes the tired lawn as a series of generous, layered borders threaded with grasses and pollinator-friendly perennials in a muted palette of purples, soft yellows and silvers. The existing silver birch is retained as an anchor and underplanted to draw the eye to the rear-left. A new, slightly larger sandstone terrace is relocated to the sunny south-west corner to catch the afternoon sun, linked to the house by a soft, informal path. A clipped box and Stipa rhythm gives year-round structure so the garden reads well in winter as much as high summer. Planting is dog-tolerant and chosen for long seasons of interest with low ongoing maintenance.",
			'render_prompt' => 'Photorealistic landscape photograph of a naturalistic south-facing English suburban rear garden in soft late-afternoon light. Generous layered borders of ornamental grasses (Stipa gigantea, Stipa) and pollinator perennials in a muted palette of purple Salvia and Verbena bonariensis, soft-yellow accents, silver foliage and Lavender, threaded around a retained silver birch. A relaxed sandstone terrace in the sunny far corner with simple seating, linked by an informal stone path. Clipped box structure for year-round form. Calm, painterly, lush but tidy; warm golden-hour mood; eye-level viewpoint from the house looking down the garden.',
		) );

		// --- Placeholder images (sketch, concept render, render-pack views) ----
		$attachment_ids = array();

		$sketch_id = self::placeholder_attachment( 'Hand sketch', 1000, 750, $project_id );
		if ( $sketch_id ) {
			$attachment_ids[] = $sketch_id;
			HGD_Project_Asset::add( $project_id, $sketch_id, 'sketch', '', 'Hand sketch' );
		}

		$render_id = self::placeholder_attachment( 'Concept render', 1000, 750, $project_id );
		if ( $render_id ) {
			$attachment_ids[] = $render_id;
			HGD_Project_Asset::add( $project_id, $render_id, 'render', '', 'Concept render' );
		}

		// Render-pack core views + a couple of seasonal variants.
		$pack_views = array(
			array( 'key' => 'masterplan',     'label' => 'Masterplan' ),
			array( 'key' => 'watercolour',    'label' => 'Watercolour visual' ),
			array( 'key' => 'plan_handdrawn', 'label' => 'Hand-drawn plan' ),
			array( 'key' => 'corner_patio',   'label' => 'Corner — Patio' ),
			array( 'key' => 'corner_border',  'label' => 'Corner — Main border' ),
			array( 'key' => 'corner_focal',   'label' => 'Corner — Focal point' ),
			array( 'key' => 'corner_border',  'label' => 'Main border — Winter' ),
			array( 'key' => 'corner_border',  'label' => 'Main border — Summer' ),
		);
		foreach ( $pack_views as $view ) {
			$att = self::placeholder_attachment( $view['label'], 1000, 750, $project_id );
			if ( $att ) {
				$attachment_ids[] = $att;
				HGD_Project_Asset::add( $project_id, $att, 'pack', $view['key'], $view['label'] );
			}
		}

		$ids['attachment_ids'] = $attachment_ids;

		// --- Quote (Good tier) -------------------------------------------------
		HGD_Quote::ensure_tiers( $project_id );
		$good = HGD_Quote::for_project_tier( $project_id, 'good' );
		if ( $good ) {
			$good_id = (int) $good['id'];

			// Believable quantities for the demo plants.
			$plant_qtys = array(
				"Lavandula angustifolia 'Hidcote'"   => 18,
				'Verbena bonariensis'                => 14,
				"Salvia nemorosa 'Caradonna'"        => 16,
				"Hydrangea paniculata 'Limelight'"   => 3,
				'Buxus sempervirens'                 => 12,
				'Stipa gigantea'                     => 5,
			);
			foreach ( $ids['plant_ids'] as $plant_id ) {
				$plant = HGD_Plant::get( $plant_id );
				if ( ! $plant ) {
					continue;
				}
				$qty = isset( $plant_qtys[ $plant['botanical_name'] ] ) ? $plant_qtys[ $plant['botanical_name'] ] : 5;
				HGD_Quote::add_plant( $good_id, $plant_id, $qty );
			}

			// Hard-landscaping / material / labour lines.
			HGD_Quote::add_item( $good_id, array(
				'item_type'     => 'material',
				'label'         => 'Sandstone paving (terrace, supply & lay materials)',
				'qty'           => 12,
				'unit'          => 'm²',
				'unit_cost_gbp' => 48.00,
				'markup_pct'    => 25,
			) );
			HGD_Quote::add_item( $good_id, array(
				'item_type'     => 'material',
				'label'         => 'Topsoil & bed preparation (compost, mulch)',
				'qty'           => 8,
				'unit'          => 'm³',
				'unit_cost_gbp' => 42.00,
				'markup_pct'    => 15,
			) );
			HGD_Quote::add_item( $good_id, array(
				'item_type'     => 'material',
				'label'         => 'Informal stone path (aggregate & edging)',
				'qty'           => 1,
				'unit'          => 'job',
				'unit_cost_gbp' => 480.00,
				'markup_pct'    => 20,
			) );
			HGD_Quote::add_item( $good_id, array(
				'item_type'     => 'labour',
				'label'         => 'Planting labour',
				'qty'           => 3,
				'unit'          => 'day',
				'unit_cost_gbp' => 250.00,
				'markup_pct'    => 0,
			) );

			HGD_Quote::compute( $good_id );

			// --- Proposal (draft, with milestones) -----------------------------
			$proposal_id = HGD_Proposal::create( $project_id, $good_id, array(
				'intro_text' => "Thank you for inviting us to design your garden, Meli. This proposal sets out the concept, the planting and materials, and a simple staged payment plan. Everything here is an example you can explore freely.",
			) );
			if ( $proposal_id ) {
				HGD_Proposal::generate_milestones( $proposal_id );
			}
		}

		update_option( self::EXAMPLE_FLAG, $ids, false );

		return (int) $project_id;
	}

	/**
	 * Ensure the demo plants exist in the catalogue. Only inserts plants that are
	 * not already present (matched by botanical name) so we never duplicate the
	 * designer's catalogue — and only the ids we actually inserted are returned,
	 * so cleanup never removes a pre-existing catalogue plant.
	 *
	 * @return int[] Plant ids the demo created (NOT pre-existing matches).
	 */
	private static function ensure_demo_plants() {
		$created = array();
		foreach ( self::demo_plants() as $plant ) {
			if ( self::plant_exists( $plant['botanical_name'] ) ) {
				continue; // Already in the catalogue — leave it alone, don't track it.
			}
			$id = HGD_Plant::insert( $plant );
			if ( $id ) {
				$created[] = (int) $id;
			}
		}
		return $created;
	}

	/** True if a plant with this botanical name already exists. */
	private static function plant_exists( $botanical_name ) {
		global $wpdb;
		$table = HGD_DB::plants_table();
		$id    = $wpdb->get_var( $wpdb->prepare(
			"SELECT id FROM {$table} WHERE botanical_name = %s LIMIT 1",
			$botanical_name
		) );
		return ! empty( $id );
	}

	/** Six believable UK garden plants with full, realistic data. */
	private static function demo_plants() {
		return array(
			array(
				'botanical_name'   => "Lavandula angustifolia 'Hidcote'",
				'common_name'      => 'English lavender',
				'plant_type'       => 'shrub',
				'pot_size'         => '2L',
				'unit_cost'        => 4.20,
				'markup_pct'       => 60,
				'supplier'         => 'Hortus Loci',
				'supplier_sku'     => 'LAV-HID-2L',
				'lead_time_days'   => 7,
				'min_order_qty'    => 10,
				'mature_height_cm' => 60,
				'mature_spread_cm' => 60,
				'spacing_per_sqm'  => 4,
				'sun'              => 'full_sun',
				'soil'             => 'Free-draining, alkaline to neutral',
				'hardiness'        => 'H5',
				'foliage'          => 'evergreen',
				'flowering_months' => 'Jun–Aug',
				'toxicity'         => 'none',
				'gbif_id'          => '',
				'notes'            => 'Compact, deep-purple English lavender. Dog-tolerant, excellent for pollinators. Demo plant.',
			),
			array(
				'botanical_name'   => 'Verbena bonariensis',
				'common_name'      => 'Argentinian vervain',
				'plant_type'       => 'perennial',
				'pot_size'         => '1L',
				'unit_cost'        => 3.10,
				'markup_pct'       => 65,
				'supplier'         => 'Kelways',
				'supplier_sku'     => 'VER-BON-1L',
				'lead_time_days'   => 5,
				'min_order_qty'    => 10,
				'mature_height_cm' => 150,
				'mature_spread_cm' => 45,
				'spacing_per_sqm'  => 5,
				'sun'              => 'full_sun',
				'soil'             => 'Moist but well-drained',
				'hardiness'        => 'H4',
				'foliage'          => 'deciduous',
				'flowering_months' => 'Jul–Oct',
				'toxicity'         => 'none',
				'gbif_id'          => '',
				'notes'            => 'Airy, see-through structure; magnet for bees and butterflies. Demo plant.',
			),
			array(
				'botanical_name'   => "Salvia nemorosa 'Caradonna'",
				'common_name'      => 'Balkan clary',
				'plant_type'       => 'perennial',
				'pot_size'         => '2L',
				'unit_cost'        => 3.80,
				'markup_pct'       => 60,
				'supplier'         => 'Hortus Loci',
				'supplier_sku'     => 'SAL-CAR-2L',
				'lead_time_days'   => 7,
				'min_order_qty'    => 10,
				'mature_height_cm' => 50,
				'mature_spread_cm' => 45,
				'spacing_per_sqm'  => 6,
				'sun'              => 'full_sun',
				'soil'             => 'Well-drained',
				'hardiness'        => 'H5',
				'foliage'          => 'deciduous',
				'flowering_months' => 'May–Jul',
				'toxicity'         => 'none',
				'gbif_id'          => '',
				'notes'            => 'Dark-stemmed violet-blue spires; long flowering with a deadhead. Demo plant.',
			),
			array(
				'botanical_name'   => "Hydrangea paniculata 'Limelight'",
				'common_name'      => 'Panicle hydrangea',
				'plant_type'       => 'shrub',
				'pot_size'         => '7.5L',
				'unit_cost'        => 18.50,
				'markup_pct'       => 50,
				'supplier'         => 'Provender Nurseries',
				'supplier_sku'     => 'HYD-LIM-75L',
				'lead_time_days'   => 10,
				'min_order_qty'    => 1,
				'mature_height_cm' => 200,
				'mature_spread_cm' => 200,
				'spacing_per_sqm'  => 1,
				'sun'              => 'part_shade',
				'soil'             => 'Moist, fertile, well-drained',
				'hardiness'        => 'H5',
				'foliage'          => 'deciduous',
				'flowering_months' => 'Jul–Sep',
				'toxicity'         => 'pets',
				'gbif_id'          => '',
				'notes'            => 'Lime-green cone flowers ageing to cream then pink. Mildly toxic to pets if eaten. Demo plant.',
			),
			array(
				'botanical_name'   => 'Buxus sempervirens',
				'common_name'      => 'Common box',
				'plant_type'       => 'hedging',
				'pot_size'         => '3L',
				'unit_cost'        => 6.90,
				'markup_pct'       => 55,
				'supplier'         => 'Provender Nurseries',
				'supplier_sku'     => 'BUX-SEM-3L',
				'lead_time_days'   => 7,
				'min_order_qty'    => 10,
				'mature_height_cm' => 100,
				'mature_spread_cm' => 80,
				'spacing_per_sqm'  => 5,
				'sun'              => 'part_shade',
				'soil'             => 'Most well-drained soils',
				'hardiness'        => 'H6',
				'foliage'          => 'evergreen',
				'flowering_months' => '—',
				'toxicity'         => 'both',
				'gbif_id'          => '',
				'notes'            => 'Clipped evergreen structure for year-round form. Foliage toxic if ingested. Demo plant.',
			),
			array(
				'botanical_name'   => 'Stipa gigantea',
				'common_name'      => 'Golden oats',
				'plant_type'       => 'grass',
				'pot_size'         => '3L',
				'unit_cost'        => 7.40,
				'markup_pct'       => 55,
				'supplier'         => 'Knoll Gardens',
				'supplier_sku'     => 'STI-GIG-3L',
				'lead_time_days'   => 10,
				'min_order_qty'    => 3,
				'mature_height_cm' => 180,
				'mature_spread_cm' => 120,
				'spacing_per_sqm'  => 1,
				'sun'              => 'full_sun',
				'soil'             => 'Light, well-drained',
				'hardiness'        => 'H5',
				'foliage'          => 'semi_evergreen',
				'flowering_months' => 'Jun–Aug',
				'toxicity'         => 'none',
				'gbif_id'          => '',
				'notes'            => 'Tall, see-through oat-like flower heads catch low sun. Demo plant.',
			),
		);
	}

	// -------------------------------------------------------------------------
	// Placeholder image generation (GD, local, no API)
	// -------------------------------------------------------------------------

	/**
	 * Create an olive/cream branded placeholder image and store it as a media
	 * attachment linked to the project. Returns the attachment id (or 0).
	 *
	 * Uses GD's built-in bitmap font (imagestring) so there is no font-file
	 * dependency.
	 *
	 * @return int Attachment id, or 0 on failure.
	 */
	private static function placeholder_attachment( $label, $w, $h, $project_id ) {
		if ( ! function_exists( 'imagecreatetruecolor' ) ) {
			return 0;
		}

		$w = max( 200, (int) $w );
		$h = max( 150, (int) $h );

		$img = imagecreatetruecolor( $w, $h );

		// Brand palette.
		$olive   = imagecolorallocate( $img, 0x49, 0x4A, 0x20 ); // #494A20
		$green   = imagecolorallocate( $img, 0x9F, 0xA1, 0x45 ); // #9FA145
		$cream   = imagecolorallocate( $img, 0xF2, 0xEC, 0xDD ); // #F2ECDD
		$charcoal = imagecolorallocate( $img, 0x1B, 0x1C, 0x18 ); // #1B1C18

		// Fill olive, then a cream inner panel with a green keyline.
		imagefilledrectangle( $img, 0, 0, $w, $h, $olive );
		$m = (int) round( min( $w, $h ) * 0.04 );
		imagefilledrectangle( $img, $m, $m, $w - $m, $h - $m, $green );
		$m2 = $m + max( 3, (int) round( $m * 0.4 ) );
		imagefilledrectangle( $img, $m2, $m2, $w - $m2, $h - $m2, $cream );

		// Label (centred) using the largest built-in GD font.
		$font   = 5;
		$fw     = imagefontwidth( $font );
		$fh     = imagefontheight( $font );
		$text   = (string) $label;
		$tx     = (int) round( ( $w - ( strlen( $text ) * $fw ) ) / 2 );
		$ty     = (int) round( $h / 2 - $fh - 18 );
		imagestring( $img, $font, $tx, $ty, $text, $olive );

		// "EXAMPLE" watermark beneath the label.
		$wm      = 'EXAMPLE';
		$wmx     = (int) round( ( $w - ( strlen( $wm ) * $fw ) ) / 2 );
		$wmy     = (int) round( $h / 2 + 6 );
		imagestring( $img, $font, $wmx, $wmy, $wm, $charcoal );

		// Brand strap along the bottom.
		$strap = 'Hillcroft Garden Designer — placeholder image';
		$sx    = (int) round( ( $w - ( strlen( $strap ) * imagefontwidth( 2 ) ) ) / 2 );
		$sy    = $h - $m2 - $fh - 6;
		imagestring( $img, 2, $sx, $sy, $strap, $olive );

		// Encode to PNG bytes.
		ob_start();
		imagepng( $img );
		$bytes = ob_get_clean();
		imagedestroy( $img );

		if ( '' === $bytes ) {
			return 0;
		}

		// Filename: slug of the label.
		$slug = sanitize_title( $label );
		if ( '' === $slug ) {
			$slug = 'example';
		}
		$filename = 'hgd-example-' . $slug . '-' . wp_generate_password( 6, false ) . '.png';

		$upload = wp_upload_bits( $filename, null, $bytes );
		if ( ! empty( $upload['error'] ) ) {
			return 0;
		}

		$filetype = wp_check_filetype( $upload['file'], null );
		$attachment = array(
			'post_mime_type' => $filetype['type'] ? $filetype['type'] : 'image/png',
			'post_title'     => '[Example] ' . $label,
			'post_content'   => '',
			'post_status'    => 'inherit',
		);

		$attach_id = wp_insert_attachment( $attachment, $upload['file'], $project_id ? (int) $project_id : 0 );
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return 0;
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		$meta = wp_generate_attachment_metadata( $attach_id, $upload['file'] );
		wp_update_attachment_metadata( $attach_id, $meta );

		return (int) $attach_id;
	}

	// -------------------------------------------------------------------------
	// Remove
	// -------------------------------------------------------------------------

	/**
	 * Delete ONLY what the demo created. Pre-existing catalogue plants and any
	 * unrelated data are never touched.
	 *
	 * @return bool True once cleanup has run.
	 */
	public static function remove() {
		$ids = self::ids();

		$project_id = (int) $ids['project_id'];

		if ( $project_id ) {
			// Proposal (+ its payments) — Proposal::delete cascades payments.
			$proposal = HGD_Proposal::for_project( $project_id );
			if ( $proposal ) {
				HGD_Proposal::delete( (int) $proposal['id'] );
			}

			// Quotes (+ their line items) — Quote::delete cascades items.
			foreach ( HGD_Quote::for_project( $project_id ) as $quote ) {
				HGD_Quote::delete( (int) $quote['id'] );
			}

			// Project asset rows (the underlying attachments are deleted below by id).
			global $wpdb;
			$wpdb->delete( HGD_DB::project_assets_table(), array( 'project_id' => $project_id ) );

			// The project row.
			HGD_Project::delete( $project_id );
		}

		// Placeholder attachments (only the ones the demo created).
		if ( ! empty( $ids['attachment_ids'] ) && is_array( $ids['attachment_ids'] ) ) {
			foreach ( $ids['attachment_ids'] as $att_id ) {
				$att_id = (int) $att_id;
				if ( $att_id ) {
					wp_delete_attachment( $att_id, true );
				}
			}
		}

		// Demo-created catalogue plants only (never pre-existing ones).
		if ( ! empty( $ids['plant_ids'] ) && is_array( $ids['plant_ids'] ) ) {
			foreach ( $ids['plant_ids'] as $plant_id ) {
				$plant_id = (int) $plant_id;
				if ( $plant_id ) {
					HGD_Plant::delete( $plant_id );
				}
			}
		}

		// Demo client.
		if ( ! empty( $ids['client_id'] ) ) {
			HGD_Client::delete( (int) $ids['client_id'] );
		}

		delete_option( self::EXAMPLE_FLAG );

		return true;
	}
}

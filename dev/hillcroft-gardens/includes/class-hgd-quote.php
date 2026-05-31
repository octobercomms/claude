<?php
/**
 * Quote model — pricing engine over the hgd_quotes + hgd_quote_items tables.
 *
 * A project carries up to three tier quotes (Good / Better / Best). Each quote
 * holds line items (plants snapshotted from the catalogue, materials, labour and
 * other) plus quote-level settings (labour days, day rate, wastage %, contingency
 * %, design fee, VAT). compute() turns all of that into a costed proposal total.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Quote {

	/** Ordered tiers. */
	const TIERS = array(
		'good'   => 'Good',
		'better' => 'Better',
		'best'   => 'Best',
	);

	/** Allowed line-item types. */
	const ITEM_TYPES = array(
		'plant'    => 'Plant',
		'material' => 'Material',
		'labour'   => 'Labour',
		'other'    => 'Other',
	);

	/** Numeric ordering weight for the three tiers (good < better < best). */
	private static function tier_weight( $tier ) {
		$order = array_keys( self::TIERS );
		$idx   = array_search( $tier, $order, true );
		return false === $idx ? 99 : $idx;
	}

	public static function tier_label( $tier ) {
		return isset( self::TIERS[ $tier ] ) ? self::TIERS[ $tier ] : ucfirst( (string) $tier );
	}

	public static function item_type_label( $type ) {
		return isset( self::ITEM_TYPES[ $type ] ) ? self::ITEM_TYPES[ $type ] : ucfirst( (string) $type );
	}

	// -------------------------------------------------------------------------
	// Quote CRUD
	// -------------------------------------------------------------------------

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::quotes_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	/**
	 * All quotes for a project, ordered good < better < best, then id.
	 *
	 * @return array
	 */
	public static function for_project( $project_id ) {
		global $wpdb;
		$table = HGD_DB::quotes_table();
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE project_id = %d
				ORDER BY FIELD(tier,'good','better','best'), id ASC",
			(int) $project_id
		), ARRAY_A );
		return $rows ? $rows : array();
	}

	/** Find a project's quote for a given tier, or null. */
	public static function for_project_tier( $project_id, $tier ) {
		global $wpdb;
		$table = HGD_DB::quotes_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE project_id = %d AND tier = %s ORDER BY id ASC LIMIT 1",
			(int) $project_id,
			$tier
		), ARRAY_A );
	}

	/**
	 * Create a quote for a project + tier, seeding settings from defaults.
	 *
	 * @return int New quote id.
	 */
	public static function create( $project_id, $tier, $overrides = array() ) {
		global $wpdb;
		$tier = isset( self::TIERS[ $tier ] ) ? $tier : 'good';
		$now  = current_time( 'mysql' );

		$data = array(
			'project_id'      => (int) $project_id,
			'tier'            => $tier,
			'title'           => self::tier_label( $tier ),
			'labour_days'     => 0, // no settings default; designer sets per quote
			'day_rate_gbp'    => round( (float) HGD_Settings::get( 'default_day_rate_gbp', 250 ), 2 ),
			'wastage_pct'     => round( (float) HGD_Settings::get( 'default_wastage_pct', 10 ), 2 ),
			'contingency_pct' => round( (float) HGD_Settings::get( 'default_contingency_pct', 5 ), 2 ),
			'design_fee_gbp'  => round( (float) HGD_Settings::get( 'default_design_fee_gbp', 0 ), 2 ),
			'vat_pct'         => round( (float) HGD_Settings::get( 'default_vat_pct', 0 ), 2 ),
			'notes'           => '',
			'created_at'      => $now,
			'updated_at'      => $now,
		);

		foreach ( $overrides as $key => $value ) {
			if ( array_key_exists( $key, $data ) ) {
				$data[ $key ] = $value;
			}
		}

		$wpdb->insert( HGD_DB::quotes_table(), $data );
		return (int) $wpdb->insert_id;
	}

	/**
	 * Update a quote's editable settings fields.
	 *
	 * @param array $clean Already-sanitised key => value pairs.
	 */
	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::quotes_table(), $clean, array( 'id' => (int) $id ) );
	}

	/** Delete a quote and all of its line items. */
	public static function delete( $id ) {
		global $wpdb;
		$wpdb->delete( HGD_DB::quote_items_table(), array( 'quote_id' => (int) $id ) );
		return false !== $wpdb->delete( HGD_DB::quotes_table(), array( 'id' => (int) $id ) );
	}

	// -------------------------------------------------------------------------
	// Item CRUD
	// -------------------------------------------------------------------------

	/** Line items for a quote, ordered by sort_order then id. */
	public static function items( $quote_id ) {
		global $wpdb;
		$table = HGD_DB::quote_items_table();
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE quote_id = %d ORDER BY sort_order ASC, id ASC",
			(int) $quote_id
		), ARRAY_A );
		return $rows ? $rows : array();
	}

	public static function get_item( $item_id ) {
		global $wpdb;
		$table = HGD_DB::quote_items_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $item_id ), ARRAY_A );
	}

	/** Next sort_order value for a quote (append to the end). */
	private static function next_sort_order( $quote_id ) {
		global $wpdb;
		$table = HGD_DB::quote_items_table();
		$max   = $wpdb->get_var( $wpdb->prepare( "SELECT MAX(sort_order) FROM {$table} WHERE quote_id = %d", (int) $quote_id ) );
		return null === $max ? 0 : ( (int) $max + 1 );
	}

	/**
	 * Add a manual line item.
	 *
	 * @param array $data item_type, plant_id, label, qty, unit, unit_cost_gbp, markup_pct, sort_order
	 * @return int New item id.
	 */
	public static function add_item( $quote_id, array $data ) {
		global $wpdb;
		$type = isset( $data['item_type'] ) && isset( self::ITEM_TYPES[ $data['item_type'] ] ) ? $data['item_type'] : 'other';

		$row = array(
			'quote_id'      => (int) $quote_id,
			'item_type'     => $type,
			'plant_id'      => isset( $data['plant_id'] ) && $data['plant_id'] ? (int) $data['plant_id'] : null,
			'label'         => isset( $data['label'] ) ? sanitize_text_field( $data['label'] ) : '',
			'qty'           => isset( $data['qty'] ) ? round( (float) $data['qty'], 2 ) : 0,
			'unit'          => isset( $data['unit'] ) ? sanitize_text_field( $data['unit'] ) : 'each',
			'unit_cost_gbp' => isset( $data['unit_cost_gbp'] ) ? round( (float) $data['unit_cost_gbp'], 2 ) : 0,
			'markup_pct'    => isset( $data['markup_pct'] ) ? round( (float) $data['markup_pct'], 2 ) : 0,
			'sort_order'    => isset( $data['sort_order'] ) ? (int) $data['sort_order'] : self::next_sort_order( $quote_id ),
			'created_at'    => current_time( 'mysql' ),
		);

		$wpdb->insert( HGD_DB::quote_items_table(), $row );
		return (int) $wpdb->insert_id;
	}

	/**
	 * Add a plant from the catalogue, snapshotting its name/cost/markup.
	 *
	 * @return int New item id (or 0 if the plant was not found).
	 */
	public static function add_plant( $quote_id, $plant_id, $qty ) {
		$plant = HGD_Plant::get( (int) $plant_id );
		if ( ! $plant ) {
			return 0;
		}
		$label = '' !== (string) $plant['botanical_name'] ? (string) $plant['botanical_name'] : (string) $plant['common_name'];
		if ( '' !== (string) $plant['common_name'] && '' !== (string) $plant['botanical_name'] ) {
			$label = $plant['botanical_name'] . ' (' . $plant['common_name'] . ')';
		}
		return self::add_item( $quote_id, array(
			'item_type'     => 'plant',
			'plant_id'      => (int) $plant_id,
			'label'         => $label,
			'qty'           => round( (float) $qty, 2 ),
			'unit'          => 'each',
			'unit_cost_gbp' => round( (float) $plant['unit_cost'], 2 ),
			'markup_pct'    => round( (float) $plant['markup_pct'], 2 ),
		) );
	}

	/**
	 * Update a line item.
	 *
	 * @param array $clean Already-sanitised key => value pairs.
	 */
	public static function update_item( $item_id, array $clean ) {
		global $wpdb;
		return false !== $wpdb->update( HGD_DB::quote_items_table(), $clean, array( 'id' => (int) $item_id ) );
	}

	public static function delete_item( $item_id ) {
		global $wpdb;
		return false !== $wpdb->delete( HGD_DB::quote_items_table(), array( 'id' => (int) $item_id ) );
	}

	// -------------------------------------------------------------------------
	// Totals
	// -------------------------------------------------------------------------

	/**
	 * Compute a full costed breakdown for a quote.
	 *
	 * Sale = qty * unit_cost * (1 + markup/100). Cost = qty * unit_cost.
	 *
	 * @return array
	 */
	public static function compute( $quote_id ) {
		$quote = self::get( $quote_id );
		if ( ! $quote ) {
			return self::empty_totals();
		}
		$items = self::items( $quote_id );

		$labour_days     = (float) $quote['labour_days'];
		$day_rate        = (float) $quote['day_rate_gbp'];
		$wastage_pct     = (float) $quote['wastage_pct'];
		$contingency_pct = (float) $quote['contingency_pct'];
		$design_fee      = round( (float) $quote['design_fee_gbp'], 2 );
		$vat_pct         = (float) $quote['vat_pct'];

		// Per-type sale + cost sums.
		$materials_sale = 0.0; // plant + material + other
		$materials_cost = 0.0;
		$labour_items_sale = 0.0; // 'labour' line items
		$labour_items_cost = 0.0;

		$lines = array();
		foreach ( $items as $item ) {
			$qty       = (float) $item['qty'];
			$unit_cost = (float) $item['unit_cost_gbp'];
			$markup    = (float) $item['markup_pct'];
			$line_cost = round( $qty * $unit_cost, 2 );
			$line_sale = round( $qty * $unit_cost * ( 1 + $markup / 100 ), 2 );

			$lines[] = array(
				'id'        => (int) $item['id'],
				'line_cost' => $line_cost,
				'line_sale' => $line_sale,
			);

			if ( 'labour' === $item['item_type'] ) {
				$labour_items_sale += $line_sale;
				$labour_items_cost += $line_cost;
			} else {
				$materials_sale += $line_sale;
				$materials_cost += $line_cost;
			}
		}

		$materials_subtotal = round( $materials_sale, 2 );
		$wastage            = round( $materials_subtotal * $wastage_pct / 100, 2 );
		$labour             = round( $labour_days * $day_rate + $labour_items_sale, 2 );

		$contingency = round( ( $materials_subtotal + $wastage + $labour ) * $contingency_pct / 100, 2 );

		$subtotal = round( $materials_subtotal + $wastage + $labour + $contingency + $design_fee, 2 );
		$vat      = round( $subtotal * $vat_pct / 100, 2 );
		$total    = round( $subtotal + $vat, 2 );

		// Internal cost basis (no markup, no design fee). Wastage + contingency
		// are real cash outflows so they apply on the cost basis too.
		$materials_cost     = round( $materials_cost, 2 );
		$cost_wastage       = round( $materials_cost * $wastage_pct / 100, 2 );
		$cost_labour        = round( $labour_days * $day_rate + $labour_items_cost, 2 );
		$cost_contingency   = round( ( $materials_cost + $cost_wastage + $cost_labour ) * $contingency_pct / 100, 2 );
		$cost_total         = round( $materials_cost + $cost_wastage + $cost_labour + $cost_contingency, 2 );

		return array(
			'quote_id'           => (int) $quote_id,
			'lines'              => $lines,
			'materials_subtotal' => $materials_subtotal,
			'wastage'            => $wastage,
			'labour'             => $labour,
			'labour_base'        => round( $labour_days * $day_rate, 2 ),
			'labour_items'       => round( $labour_items_sale, 2 ),
			'contingency'        => $contingency,
			'design_fee'         => $design_fee,
			'subtotal'           => $subtotal,
			'vat'                => $vat,
			'total'              => $total,
			'total_rounded'      => round( $total ), // nearest whole pound
			'cost_total'         => $cost_total,
			// Margin compares the ex-VAT sale subtotal against cost — VAT is a
			// pass-through to HMRC, not profit, so it's excluded from both sides.
			'margin'             => round( $subtotal - $cost_total, 2 ),
		);
	}

	private static function empty_totals() {
		return array(
			'quote_id'           => 0,
			'lines'              => array(),
			'materials_subtotal' => 0.0,
			'wastage'            => 0.0,
			'labour'             => 0.0,
			'labour_base'        => 0.0,
			'labour_items'       => 0.0,
			'contingency'        => 0.0,
			'design_fee'         => 0.0,
			'subtotal'           => 0.0,
			'vat'                => 0.0,
			'total'              => 0.0,
			'total_rounded'      => 0.0,
			'cost_total'         => 0.0,
			'margin'             => 0.0,
		);
	}

	// -------------------------------------------------------------------------
	// Tier helpers
	// -------------------------------------------------------------------------

	/**
	 * Ensure a project has the three tier quotes. Creates any that are missing.
	 *
	 * @return array The project's quotes (after creation).
	 */
	public static function ensure_tiers( $project_id ) {
		$existing = self::for_project( $project_id );
		$have     = array();
		foreach ( $existing as $q ) {
			$have[ $q['tier'] ] = true;
		}
		foreach ( array_keys( self::TIERS ) as $tier ) {
			if ( empty( $have[ $tier ] ) ) {
				self::create( $project_id, $tier );
			}
		}
		return self::for_project( $project_id );
	}

	/**
	 * Copy a source quote's plant + material items into the target tier quote,
	 * scaling qty by the uplift %. The target quote is created if missing; its
	 * existing plant/material items are cleared first so the seed is idempotent.
	 * Labour days + settings are copied across too (uplift applies to labour days).
	 *
	 * @param int   $source_quote_id Source (usually the 'good') quote.
	 * @param string $target_tier    'better' | 'best'.
	 * @param float $uplift_pct      e.g. 25 → multiply qty/labour by 1.25.
	 * @return int Target quote id (or 0 on failure).
	 */
	public static function duplicate_to_tier( $source_quote_id, $target_tier, $uplift_pct ) {
		global $wpdb;

		$source = self::get( $source_quote_id );
		if ( ! $source ) {
			return 0;
		}
		$target_tier = isset( self::TIERS[ $target_tier ] ) ? $target_tier : 'better';
		$project_id  = (int) $source['project_id'];
		$factor      = 1 + ( (float) $uplift_pct / 100 );

		// Find or create the target tier quote.
		$target = self::for_project_tier( $project_id, $target_tier );
		if ( $target ) {
			$target_id = (int) $target['id'];
		} else {
			$target_id = self::create( $project_id, $target_tier );
		}

		// Carry the source quote's settings across, scaling labour days by uplift.
		self::update( $target_id, array(
			'labour_days'     => round( (float) $source['labour_days'] * $factor, 2 ),
			'day_rate_gbp'    => round( (float) $source['day_rate_gbp'], 2 ),
			'wastage_pct'     => round( (float) $source['wastage_pct'], 2 ),
			'contingency_pct' => round( (float) $source['contingency_pct'], 2 ),
			'design_fee_gbp'  => round( (float) $source['design_fee_gbp'], 2 ),
			'vat_pct'         => round( (float) $source['vat_pct'], 2 ),
		) );

		// Clear the target's existing items so re-seeding doesn't duplicate.
		$wpdb->delete( HGD_DB::quote_items_table(), array( 'quote_id' => $target_id ) );

		$sort = 0;
		foreach ( self::items( $source_quote_id ) as $item ) {
			$qty = round( (float) $item['qty'] * $factor, 2 );
			self::add_item( $target_id, array(
				'item_type'     => $item['item_type'],
				'plant_id'      => $item['plant_id'],
				'label'         => $item['label'],
				'qty'           => $qty,
				'unit'          => $item['unit'],
				'unit_cost_gbp' => round( (float) $item['unit_cost_gbp'], 2 ),
				'markup_pct'    => round( (float) $item['markup_pct'], 2 ),
				'sort_order'    => $sort++,
			) );
		}

		return $target_id;
	}

	/**
	 * Sanitise a raw input array of quote settings down to known columns.
	 */
	public static function sanitise_settings( array $raw ) {
		return array(
			'title'           => isset( $raw['title'] ) ? sanitize_text_field( wp_unslash( $raw['title'] ) ) : '',
			'labour_days'     => isset( $raw['labour_days'] ) ? round( (float) $raw['labour_days'], 2 ) : 0,
			'day_rate_gbp'    => isset( $raw['day_rate_gbp'] ) ? round( (float) $raw['day_rate_gbp'], 2 ) : 0,
			'wastage_pct'     => isset( $raw['wastage_pct'] ) ? round( (float) $raw['wastage_pct'], 2 ) : 0,
			'contingency_pct' => isset( $raw['contingency_pct'] ) ? round( (float) $raw['contingency_pct'], 2 ) : 0,
			'design_fee_gbp'  => isset( $raw['design_fee_gbp'] ) ? round( (float) $raw['design_fee_gbp'], 2 ) : 0,
			'vat_pct'         => isset( $raw['vat_pct'] ) ? round( (float) $raw['vat_pct'], 2 ) : 0,
			'notes'           => isset( $raw['notes'] ) ? sanitize_textarea_field( wp_unslash( $raw['notes'] ) ) : '',
		);
	}

	/**
	 * Sanitise a raw input array of line-item fields down to known columns.
	 */
	public static function sanitise_item( array $raw ) {
		$type = isset( $raw['item_type'] ) ? sanitize_key( $raw['item_type'] ) : 'other';
		$type = isset( self::ITEM_TYPES[ $type ] ) ? $type : 'other';
		return array(
			'item_type'     => $type,
			'label'         => isset( $raw['label'] ) ? sanitize_text_field( wp_unslash( $raw['label'] ) ) : '',
			'qty'           => isset( $raw['qty'] ) ? round( (float) $raw['qty'], 2 ) : 0,
			'unit'          => isset( $raw['unit'] ) ? sanitize_text_field( wp_unslash( $raw['unit'] ) ) : 'each',
			'unit_cost_gbp' => isset( $raw['unit_cost_gbp'] ) ? round( (float) $raw['unit_cost_gbp'], 2 ) : 0,
			'markup_pct'    => isset( $raw['markup_pct'] ) ? round( (float) $raw['markup_pct'], 2 ) : 0,
		);
	}

	/** Verify an item belongs to the given quote (which belongs to a project). */
	public static function item_belongs_to_quote( $item_id, $quote_id ) {
		$item = self::get_item( $item_id );
		return $item && (int) $item['quote_id'] === (int) $quote_id;
	}

	/** Verify a quote belongs to the given project. */
	public static function quote_belongs_to_project( $quote_id, $project_id ) {
		$quote = self::get( $quote_id );
		return $quote && (int) $quote['project_id'] === (int) $project_id;
	}
}

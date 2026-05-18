<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ADF_Campaign {

	// -------------------------------------------------------------------------
	// Campaign CRUD
	// -------------------------------------------------------------------------

	public static function get_all( $args = array() ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_campaigns';

		$defaults = array(
			'status'  => '',
			'orderby' => 'created_at',
			'order'   => 'DESC',
		);
		$args = wp_parse_args( $args, $defaults );

		$where = '1=1';
		$params = array();

		if ( ! empty( $args['status'] ) ) {
			$where   .= ' AND status = %s';
			$params[] = $args['status'];
		}

		$orderby = sanitize_sql_orderby( $args['orderby'] . ' ' . $args['order'] ) ?: 'created_at DESC';

		if ( $params ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE {$where} ORDER BY {$orderby}", ...$params ) );
		}

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return $wpdb->get_results( "SELECT * FROM {$table} WHERE {$where} ORDER BY {$orderby}" );
	}

	public static function get( $id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_campaigns';
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
	}

	public static function create( $data ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_campaigns';

		$insert = self::sanitize_campaign_data( $data );
		$wpdb->insert( $table, $insert );
		return $wpdb->insert_id;
	}

	public static function update( $id, $data ) {
		global $wpdb;
		$table  = $wpdb->prefix . 'adf_campaigns';
		$update = self::sanitize_campaign_data( $data );
		return $wpdb->update( $table, $update, array( 'id' => $id ) );
	}

	public static function delete( $id ) {
		global $wpdb;

		// Remove tracking records and ads first.
		$ads = self::get_ads_for_campaign( $id );
		foreach ( $ads as $ad ) {
			$wpdb->delete( $wpdb->prefix . 'adf_tracking', array( 'ad_id' => $ad->id ) );
		}
		$wpdb->delete( $wpdb->prefix . 'adf_ads', array( 'campaign_id' => $id ) );
		$wpdb->delete( $wpdb->prefix . 'adf_tracking', array( 'campaign_id' => $id ) );
		$wpdb->delete( $wpdb->prefix . 'adf_campaigns', array( 'id' => $id ) );
	}

	private static function sanitize_campaign_data( $data ) {
		return array(
			'name'                 => sanitize_text_field( $data['name'] ?? '' ),
			'client_name'          => sanitize_text_field( $data['client_name'] ?? '' ),
			'url'                  => esc_url_raw( $data['url'] ?? '' ),
			'status'               => in_array( $data['status'] ?? '', array( 'active', 'inactive' ), true ) ? $data['status'] : 'inactive',
			'start_date'           => ! empty( $data['start_date'] ) ? sanitize_text_field( $data['start_date'] ) : null,
			'end_date'             => ! empty( $data['end_date'] ) ? sanitize_text_field( $data['end_date'] ) : null,
			'restrict_impressions' => ! empty( $data['restrict_impressions'] ) ? 1 : 0,
			'max_impressions'      => ! empty( $data['max_impressions'] ) ? absint( $data['max_impressions'] ) : null,
			'restrict_clicks'      => ! empty( $data['restrict_clicks'] ) ? 1 : 0,
			'max_clicks'           => ! empty( $data['max_clicks'] ) ? absint( $data['max_clicks'] ) : null,
		);
	}

	// -------------------------------------------------------------------------
	// Ad CRUD
	// -------------------------------------------------------------------------

	public static function get_ads_for_campaign( $campaign_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_ads';
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE campaign_id = %d", $campaign_id ) );
	}

	public static function get_ad( $ad_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_ads';
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $ad_id ) );
	}

	public static function get_ad_for_format( $campaign_id, $format ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_ads';
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE campaign_id = %d AND format = %s",
			$campaign_id, $format
		) );
	}

	public static function save_ad( $campaign_id, $format, $image_url, $alt_text = '' ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_ads';

		$existing = self::get_ad_for_format( $campaign_id, $format );
		if ( $existing ) {
			$wpdb->update(
				$table,
				array( 'image_url' => esc_url_raw( $image_url ), 'alt_text' => sanitize_text_field( $alt_text ) ),
				array( 'id' => $existing->id )
			);
			return $existing->id;
		}

		$wpdb->insert( $table, array(
			'campaign_id' => $campaign_id,
			'format'      => sanitize_key( $format ),
			'image_url'   => esc_url_raw( $image_url ),
			'alt_text'    => sanitize_text_field( $alt_text ),
		) );
		return $wpdb->insert_id;
	}

	public static function delete_ad_for_format( $campaign_id, $format ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_ads';
		$wpdb->delete( $table, array( 'campaign_id' => $campaign_id, 'format' => $format ) );
	}

	// -------------------------------------------------------------------------
	// Rotation logic — pick one eligible ad for a given format
	// -------------------------------------------------------------------------

	public static function get_active_ad_for_format( $format ) {
		global $wpdb;

		$today = current_time( 'Y-m-d' );
		$campaigns_table = $wpdb->prefix . 'adf_campaigns';
		$ads_table       = $wpdb->prefix . 'adf_ads';
		$tracking_table  = $wpdb->prefix . 'adf_tracking';

		// Fetch all active campaigns that have an ad for this format and are in date range.
		$campaigns = $wpdb->get_results( $wpdb->prepare(
			"SELECT c.*, a.id AS ad_id, a.image_url, a.alt_text
			FROM {$campaigns_table} c
			INNER JOIN {$ads_table} a ON a.campaign_id = c.id AND a.format = %s
			WHERE c.status = 'active'
			AND (c.start_date IS NULL OR c.start_date <= %s)
			AND (c.end_date IS NULL OR c.end_date >= %s)
			ORDER BY RAND()",
			$format, $today, $today
		) );

		if ( empty( $campaigns ) ) {
			return null;
		}

		// Filter campaigns that have exhausted their restrictions.
		foreach ( $campaigns as $campaign ) {
			if ( $campaign->restrict_impressions && $campaign->max_impressions ) {
				$impressions = ADF_Tracker::get_count( $campaign->id, 'impression' );
				if ( $impressions >= $campaign->max_impressions ) {
					continue;
				}
			}

			if ( $campaign->restrict_clicks && $campaign->max_clicks ) {
				$clicks = ADF_Tracker::get_count( $campaign->id, 'click' );
				if ( $clicks >= $campaign->max_clicks ) {
					continue;
				}
			}

			return $campaign;
		}

		return null;
	}

	// -------------------------------------------------------------------------
	// Stats helpers
	// -------------------------------------------------------------------------

	public static function get_stats_for_all() {
		global $wpdb;
		$tracking_table = $wpdb->prefix . 'adf_tracking';

		$rows = $wpdb->get_results(
			"SELECT campaign_id, type, COUNT(*) AS total FROM {$tracking_table} GROUP BY campaign_id, type"
		);

		$stats = array();
		foreach ( $rows as $row ) {
			if ( ! isset( $stats[ $row->campaign_id ] ) ) {
				$stats[ $row->campaign_id ] = array( 'impressions' => 0, 'clicks' => 0 );
			}
			$stats[ $row->campaign_id ][ $row->type === 'impression' ? 'impressions' : 'clicks' ] = (int) $row->total;
		}

		return $stats;
	}
}

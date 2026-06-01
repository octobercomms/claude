<?php
/**
 * Project asset model — uploaded consultation media (sketches / photos) linked to
 * a project. Each row points at a WordPress media-library attachment.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Project_Asset {

	/** Allowed roles. */
	const ROLES = array(
		'sketch' => 'Sketch',
		'photo'  => 'Photo',
		'plan'   => 'Plan drawing',
		'render' => 'Concept render',
		'pack'   => 'Render pack',
		'other'  => 'Other',
	);

	public static function role_label( $role ) {
		return isset( self::ROLES[ $role ] ) ? self::ROLES[ $role ] : ucfirst( (string) $role );
	}

	/**
	 * Link an attachment to a project.
	 *
	 * @param string $view_key Optional pack-view key (e.g. 'masterplan', 'corner_1').
	 * @param string $label    Optional human label for the view.
	 * @return int Inserted row id.
	 */
	public static function add( $project_id, $attachment_id, $role = 'photo', $view_key = '', $label = '' ) {
		global $wpdb;
		$role = isset( self::ROLES[ $role ] ) ? $role : 'other';
		$wpdb->insert( HGD_DB::project_assets_table(), array(
			'project_id'    => (int) $project_id,
			'attachment_id' => (int) $attachment_id,
			'role'          => $role,
			'view_key'      => sanitize_key( $view_key ),
			'label'         => sanitize_text_field( $label ),
			'created_at'    => current_time( 'mysql' ),
		) );
		return (int) $wpdb->insert_id;
	}

	/** Rows for a project, oldest first. Optionally filter by role. */
	public static function for_project( $project_id, $role = '' ) {
		global $wpdb;
		$table = HGD_DB::project_assets_table();
		if ( '' !== $role ) {
			$rows = $wpdb->get_results( $wpdb->prepare(
				"SELECT * FROM {$table} WHERE project_id = %d AND role = %s ORDER BY id ASC",
				(int) $project_id,
				$role
			), ARRAY_A );
		} else {
			$rows = $wpdb->get_results( $wpdb->prepare(
				"SELECT * FROM {$table} WHERE project_id = %d ORDER BY id ASC",
				(int) $project_id
			), ARRAY_A );
		}
		return $rows ? $rows : array();
	}

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::project_assets_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	/** Delete a row and its underlying media attachment. */
	public static function delete( $id ) {
		global $wpdb;
		$row = self::get( $id );
		if ( ! $row ) {
			return false;
		}
		if ( ! empty( $row['attachment_id'] ) ) {
			wp_delete_attachment( (int) $row['attachment_id'], true );
		}
		return false !== $wpdb->delete( HGD_DB::project_assets_table(), array( 'id' => (int) $id ) );
	}

	/**
	 * Mark a render as the single approved "hero" render for its project,
	 * clearing approval from any other render on the same project. Pass a row
	 * that is already approved to toggle it off.
	 *
	 * @return string 'approved' | 'cleared'
	 */
	public static function toggle_approved( $asset_id, $project_id ) {
		global $wpdb;
		$table = HGD_DB::project_assets_table();
		$row   = self::get( $asset_id );
		$was   = $row && ! empty( $row['approved'] );

		// Only one approved render per project: clear all first.
		$wpdb->query( $wpdb->prepare(
			"UPDATE {$table} SET approved = 0 WHERE project_id = %d AND role = 'render'",
			(int) $project_id
		) );

		if ( $was ) {
			return 'cleared';
		}
		$wpdb->update( $table, array( 'approved' => 1 ), array( 'id' => (int) $asset_id ) );
		return 'approved';
	}

	/** The approved render row for a project, or null. */
	public static function approved_render( $project_id ) {
		global $wpdb;
		$table = HGD_DB::project_assets_table();
		$row   = $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE project_id = %d AND role = 'render' AND approved = 1 ORDER BY id DESC LIMIT 1",
			(int) $project_id
		), ARRAY_A );
		return $row ? $row : null;
	}

	/** Persist a render scorecard (score 0–100 + structured review JSON). */
	public static function save_review( $asset_id, $score, array $review ) {
		global $wpdb;
		$score = max( 0, min( 100, (int) $score ) );
		return false !== $wpdb->update(
			HGD_DB::project_assets_table(),
			array( 'score' => $score, 'review' => wp_json_encode( $review ) ),
			array( 'id' => (int) $asset_id )
		);
	}

	/** Decode a stored scorecard review into an array (or empty array). */
	public static function review( $row ) {
		if ( ! is_array( $row ) || empty( $row['review'] ) ) {
			return array();
		}
		$data = json_decode( (string) $row['review'], true );
		return is_array( $data ) ? $data : array();
	}
}

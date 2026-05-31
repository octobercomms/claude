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
}

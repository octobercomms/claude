<?php
/**
 * Capture chat model — the Claude Q&A thread that refines a project's design brief.
 *
 * Stores a simple conversation (user / assistant turns) per project in the
 * hgd_chat table. The handler in HGD_Admin sends each new user message to Claude,
 * which replies conversationally and returns an updated design brief.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Chat {

	/** All messages for a project, oldest first. */
	public static function messages( $project_id ) {
		global $wpdb;
		$table = HGD_DB::chat_table();
		$rows  = $wpdb->get_results(
			$wpdb->prepare( "SELECT * FROM {$table} WHERE project_id = %d ORDER BY id ASC", (int) $project_id ),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/** Append a message; role is 'user' or 'assistant'. */
	public static function add( $project_id, $role, $body ) {
		global $wpdb;
		$role = ( 'assistant' === $role ) ? 'assistant' : 'user';
		$wpdb->insert(
			HGD_DB::chat_table(),
			array(
				'project_id' => (int) $project_id,
				'role'       => $role,
				'body'       => (string) $body,
				'created_at' => current_time( 'mysql' ),
			)
		);
		return (int) $wpdb->insert_id;
	}

	/** Remove the whole thread for a project. */
	public static function clear( $project_id ) {
		global $wpdb;
		return false !== $wpdb->delete( HGD_DB::chat_table(), array( 'project_id' => (int) $project_id ) );
	}

	/** How many messages a project's thread holds. */
	public static function count( $project_id ) {
		global $wpdb;
		$table = HGD_DB::chat_table();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE project_id = %d", (int) $project_id ) );
	}
}

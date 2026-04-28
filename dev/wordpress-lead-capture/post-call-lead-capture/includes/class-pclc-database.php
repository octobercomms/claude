<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Database {

	const TABLE_NAME = 'lead_capture_contacts';

	public static function create_table() {
		global $wpdb;

		$table_name      = $wpdb->prefix . self::TABLE_NAME;
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			first_name VARCHAR(100) NOT NULL,
			last_name VARCHAR(100) NOT NULL,
			email VARCHAR(255) NOT NULL,
			project_type VARCHAR(50) NOT NULL,
			date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			status VARCHAR(20) NOT NULL DEFAULT 'active',
			followup_1_sent TINYINT(1) NOT NULL DEFAULT 0,
			followup_2_sent TINYINT(1) NOT NULL DEFAULT 0,
			chase_email_sent TINYINT(1) NOT NULL DEFAULT 0,
			cold_email_sent TINYINT(1) NOT NULL DEFAULT 0,
			PRIMARY KEY (id)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		update_option( 'pclc_db_version', PCLC_VERSION );
	}

	public static function insert_contact( $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		$result = $wpdb->insert(
			$table_name,
			array(
				'first_name'   => sanitize_text_field( $data['first_name'] ),
				'last_name'    => sanitize_text_field( $data['last_name'] ),
				'email'        => sanitize_email( $data['email'] ),
				'project_type' => sanitize_text_field( $data['project_type'] ),
				'date_created' => current_time( 'mysql' ),
				'status'       => 'active',
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s' )
		);

		if ( false === $result ) {
			return false;
		}

		return $wpdb->insert_id;
	}

	public static function get_contact( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		return $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$table_name} WHERE id = %d", intval( $id ) )
		);
	}

	public static function mark_deleted( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		return $wpdb->update(
			$table_name,
			array( 'status' => 'deleted' ),
			array( 'id' => intval( $id ) ),
			array( '%s' ),
			array( '%d' )
		);
	}

	public static function mark_followup_sent( $id, $followup_number ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;
		$field      = 'followup_' . intval( $followup_number ) . '_sent';

		return $wpdb->update(
			$table_name,
			array( $field => 1 ),
			array( 'id' => intval( $id ) ),
			array( '%d' ),
			array( '%d' )
		);
	}

	public static function mark_chase_email_sent( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		return $wpdb->update(
			$table_name,
			array( 'chase_email_sent' => 1 ),
			array( 'id' => intval( $id ) ),
			array( '%d' ),
			array( '%d' )
		);
	}

	public static function mark_cold_email_sent( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		return $wpdb->update(
			$table_name,
			array( 'cold_email_sent' => 1 ),
			array( 'id' => intval( $id ) ),
			array( '%d' ),
			array( '%d' )
		);
	}

	public static function get_latest_contact() {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;

		return $wpdb->get_row(
			"SELECT * FROM {$table_name} WHERE status = 'active' ORDER BY id DESC LIMIT 1"
		);
	}

	public static function drop_table() {
		global $wpdb;

		$table_name = $wpdb->prefix . self::TABLE_NAME;
		$wpdb->query( "DROP TABLE IF EXISTS {$table_name}" );
	}
}

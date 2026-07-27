<?php
/**
 * Registers the "Popup" custom post type and its admin list columns.
 *
 * The popup body is ordinary post content, so any page builder that edits a
 * post's content — WP Bakery, Elementor, Gutenberg, the classic editor — can
 * build it. The trigger/targeting settings live in a separate meta box
 * (see class-ocpop-meta.php), not on the builder canvas.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_CPT_Registrar {

	public static function init() {
		// Register early (priority 5) so page builders that inspect post types
		// on `init` already see ours when they wire up their editors.
		add_action( 'init', array( __CLASS__, 'register' ), 5 );

		add_filter( 'manage_' . OCPOP_CPT . '_posts_columns', array( __CLASS__, 'columns' ) );
		add_action( 'manage_' . OCPOP_CPT . '_posts_custom_column', array( __CLASS__, 'column_content' ), 10, 2 );
	}

	public static function register() {
		$labels = array(
			'name'               => __( 'Popups', 'october-popups' ),
			'singular_name'      => __( 'Popup', 'october-popups' ),
			'menu_name'          => __( 'Popups', 'october-popups' ),
			'add_new'            => __( 'Add New', 'october-popups' ),
			'add_new_item'       => __( 'Add New Popup', 'october-popups' ),
			'edit_item'          => __( 'Edit Popup', 'october-popups' ),
			'new_item'           => __( 'New Popup', 'october-popups' ),
			'view_item'          => __( 'Preview Popup', 'october-popups' ),
			'search_items'       => __( 'Search Popups', 'october-popups' ),
			'not_found'          => __( 'No popups yet', 'october-popups' ),
			'not_found_in_trash' => __( 'No popups in trash', 'october-popups' ),
			'all_items'          => __( 'All Popups', 'october-popups' ),
		);

		register_post_type(
			OCPOP_CPT,
			array(
				'labels'              => $labels,
				'public'              => true,
				// Not a standalone page on the site; it only ever renders inside
				// the popup shell. But it must be publicly queryable so Elementor
				// and WP Bakery will open their editors on it.
				'publicly_queryable'  => true,
				'exclude_from_search' => true,
				'has_archive'         => false,
				'rewrite'             => false,
				'show_ui'             => true,
				'show_in_menu'        => true,
				'show_in_rest'        => true, // Gutenberg fallback + builder handshakes.
				'menu_icon'           => 'dashicons-external',
				'menu_position'       => 26,
				'supports'            => array( 'title', 'editor', 'revisions', 'author' ),
				'capability_type'     => 'post',
			)
		);
	}

	public static function columns( $columns ) {
		$new = array();
		foreach ( $columns as $key => $label ) {
			$new[ $key ] = $label;
			if ( 'title' === $key ) {
				$new['ocpop_status']   = __( 'Status', 'october-popups' );
				$new['ocpop_trigger']  = __( 'Trigger', 'october-popups' );
				$new['ocpop_schedule'] = __( 'Schedule', 'october-popups' );
				$new['ocpop_views']    = __( 'Views', 'october-popups' );
			}
		}
		return $new;
	}

	public static function column_content( $column, $post_id ) {
		$s = OCPOP_Meta::get_settings( $post_id );

		switch ( $column ) {
			case 'ocpop_status':
				if ( empty( $s['enabled'] ) ) {
					echo '<span style="color:#b32d2e;font-weight:600;">' . esc_html__( 'Disabled', 'october-popups' ) . '</span>';
				} elseif ( ! OCPOP_Frontend::within_schedule( $s ) ) {
					echo '<span style="color:#996800;font-weight:600;">' . esc_html__( 'Scheduled / expired', 'october-popups' ) . '</span>';
				} else {
					echo '<span style="color:#0a7c2f;font-weight:600;">' . esc_html__( 'Live', 'october-popups' ) . '</span>';
				}
				break;

			case 'ocpop_trigger':
				$labels = self::trigger_labels();
				$type   = isset( $s['trigger_type'] ) ? $s['trigger_type'] : 'delay';
				echo esc_html( isset( $labels[ $type ] ) ? $labels[ $type ] : $type );
				break;

			case 'ocpop_schedule':
				$start = ! empty( $s['start_date'] ) ? $s['start_date'] : '—';
				$end   = ! empty( $s['end_date'] ) ? $s['end_date'] : '—';
				echo esc_html( $start . '  →  ' . $end );
				break;

			case 'ocpop_views':
				$views  = (int) get_post_meta( $post_id, '_ocpop_views', true );
				$convs  = (int) get_post_meta( $post_id, '_ocpop_conversions', true );
				printf(
					'%s / %s',
					'<strong>' . esc_html( number_format_i18n( $views ) ) . '</strong>',
					esc_html( number_format_i18n( $convs ) . ' ' . __( 'clicks', 'october-popups' ) )
				);
				break;
		}
	}

	public static function trigger_labels() {
		return array(
			'load'   => __( 'Immediately on load', 'october-popups' ),
			'delay'  => __( 'After a time delay', 'october-popups' ),
			'scroll' => __( 'On scroll depth', 'october-popups' ),
			'exit'   => __( 'On exit intent', 'october-popups' ),
			'idle'   => __( 'After inactivity', 'october-popups' ),
			'click'  => __( 'On element click', 'october-popups' ),
			'manual' => __( 'Manual only (class / shortcode)', 'october-popups' ),
		);
	}
}

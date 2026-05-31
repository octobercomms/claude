<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_CPT {

	public static function init() {
		add_action( 'init', array( __CLASS__, 'register' ) );
	}

	public static function register() {
		register_post_type( HGDF_CPT, array(
			'labels'             => array(
				'name'               => 'Forms',
				'singular_name'      => 'Form',
				'menu_name'          => 'Forms',
				'add_new_item'       => 'Add New Form',
				'edit_item'          => 'Edit Form',
				'new_item'           => 'New Form',
				'search_items'       => 'Search Forms',
				'not_found'          => 'No forms found',
				'all_items'          => 'Forms',
			),
			'public'             => false,
			'publicly_queryable' => false,
			'show_ui'            => true,
			'show_in_menu'       => 'hgd-dashboard', // appears under the Designer menu
			'capability_type'    => 'post',
			'supports'           => array( 'title' ),
			'has_archive'        => false,
			'rewrite'            => false,
		) );
	}

	public static function exists( $form_id ) {
		return get_post_type( $form_id ) === HGDF_CPT && get_post_status( $form_id ) !== false;
	}
}

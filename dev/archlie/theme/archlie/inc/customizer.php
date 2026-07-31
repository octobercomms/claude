<?php
/**
 * Archlie — Customizer settings.
 *
 * Editable without touching templates: hero copy, the registration/company
 * numbers the brief (§2) requires shown, and the notification email.
 *
 * @package Archlie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Defaults, referenced by both the Customizer and the templates.
 *
 * @return array
 */
function archlie_defaults() {
	return array(
		'archlie_hero_eyebrow' => __( 'Architectural drawings, priced instantly', 'archlie' ),
		'archlie_hero_heading' => __( 'Fixed-price drawings from registered architects.', 'archlie' ),
		'archlie_hero_lede'    => __( 'Planning, building control and permitted development drawings for standard residential work. Build your project in a short conversation, see a fixed price as you go, and submit when you’re ready — no call required.', 'archlie' ),
		'archlie_arb_no'       => __( '[to confirm]', 'archlie' ),
		'archlie_company_no'   => __( '[to confirm]', 'archlie' ),
		'archlie_notify_email' => get_option( 'admin_email' ),
	);
}

/**
 * Get a theme setting with its default.
 *
 * @param string $key Setting key.
 * @return string
 */
function archlie_get( $key ) {
	$d = archlie_defaults();
	return get_theme_mod( $key, isset( $d[ $key ] ) ? $d[ $key ] : '' );
}

/**
 * Register Customizer section, settings and controls.
 *
 * @param WP_Customize_Manager $wp_customize Manager.
 */
function archlie_customize_register( $wp_customize ) {
	$wp_customize->add_section(
		'archlie_content',
		array(
			'title'       => __( 'Archlie', 'archlie' ),
			'priority'    => 30,
			'description' => __( 'Hero copy, registration numbers (shown on the site per brief §2), and notifications.', 'archlie' ),
		)
	);

	$controls = array(
		'archlie_hero_eyebrow' => array( 'label' => __( 'Hero eyebrow', 'archlie' ), 'type' => 'text' ),
		'archlie_hero_heading' => array( 'label' => __( 'Hero heading', 'archlie' ), 'type' => 'textarea' ),
		'archlie_hero_lede'    => array( 'label' => __( 'Hero intro', 'archlie' ), 'type' => 'textarea' ),
		'archlie_arb_no'       => array( 'label' => __( 'ARB registration number', 'archlie' ), 'type' => 'text' ),
		'archlie_company_no'   => array( 'label' => __( 'Company number', 'archlie' ), 'type' => 'text' ),
		'archlie_notify_email' => array( 'label' => __( 'Notification email', 'archlie' ), 'type' => 'email' ),
	);

	$d = archlie_defaults();
	foreach ( $controls as $id => $args ) {
		$sanitize = 'email' === $args['type'] ? 'sanitize_email' : ( 'textarea' === $args['type'] ? 'sanitize_textarea_field' : 'sanitize_text_field' );
		$wp_customize->add_setting( $id, array( 'default' => $d[ $id ], 'sanitize_callback' => $sanitize, 'transport' => 'refresh' ) );
		$wp_customize->add_control( $id, array( 'label' => $args['label'], 'section' => 'archlie_content', 'type' => $args['type'] ) );
	}
}
add_action( 'customize_register', 'archlie_customize_register' );

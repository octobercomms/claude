<?php
/**
 * Architects Direct — Customizer settings.
 *
 * Keeps the highest-churn content editable without touching templates: the
 * hero copy and the address new-project notifications are sent to.
 *
 * @package Architects_Direct
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register Customizer sections, settings and controls.
 *
 * @param WP_Customize_Manager $wp_customize Customizer manager.
 */
function ad_customize_register( $wp_customize ) {
	$wp_customize->add_section(
		'ad_content',
		array(
			'title'       => __( 'Architects Direct', 'architects-direct' ),
			'priority'    => 30,
			'description' => __( 'Hero copy and where new-project notifications are sent.', 'architects-direct' ),
		)
	);

	$fields = array(
		'ad_hero_eyebrow'  => array(
			'label'   => __( 'Hero eyebrow', 'architects-direct' ),
			'default' => __( 'Architectural drawings, made simple', 'architects-direct' ),
			'type'    => 'text',
		),
		'ad_hero_heading'  => array(
			'label'   => __( 'Hero heading', 'architects-direct' ),
			'default' => __( 'Fixed-price architectural drawings. Priced online. No call required.', 'architects-direct' ),
			'type'    => 'textarea',
		),
		'ad_hero_lede'     => array(
			'label'   => __( 'Hero intro paragraph', 'architects-direct' ),
			'default' => __( 'Planning, building control, permitted development and tender packages for standard residential works. Choose your service, get an instant fixed price, and send us your brief in under five minutes.', 'architects-direct' ),
			'type'    => 'textarea',
		),
		'ad_notify_email'  => array(
			'label'   => __( 'New-project notification email', 'architects-direct' ),
			'default' => get_option( 'admin_email' ),
			'type'    => 'email',
		),
	);

	foreach ( $fields as $id => $args ) {
		$sanitize = 'ad_notify_email' === $id ? 'sanitize_email' : ( 'text' === $args['type'] ? 'sanitize_text_field' : 'sanitize_textarea_field' );
		$wp_customize->add_setting(
			$id,
			array(
				'default'           => $args['default'],
				'sanitize_callback' => $sanitize,
				'transport'         => 'refresh',
			)
		);
		$wp_customize->add_control(
			$id,
			array(
				'label'   => $args['label'],
				'section' => 'ad_content',
				'type'    => $args['type'],
			)
		);
	}
}
add_action( 'customize_register', 'ad_customize_register' );

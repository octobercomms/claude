<?php
/**
 * Archlie theme bootstrap.
 *
 * @package Archlie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ARCHLIE_VERSION', '1.0.0' );
define( 'ARCHLIE_BUILDER_TEMPLATE', 'template-project-builder.php' );

require_once get_template_directory() . '/inc/pricing.php';
require_once get_template_directory() . '/inc/customizer.php';
require_once get_template_directory() . '/inc/intake.php';

/**
 * Theme setup.
 */
function archlie_setup() {
	load_theme_textdomain( 'archlie', get_template_directory() . '/languages' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ) );
	add_theme_support( 'custom-logo', array( 'height' => 40, 'width' => 40, 'flex-height' => true, 'flex-width' => true ) );
	register_nav_menus( array(
		'primary' => __( 'Primary menu', 'archlie' ),
		'footer'  => __( 'Footer menu', 'archlie' ),
	) );
}
add_action( 'after_setup_theme', 'archlie_setup' );

/**
 * Is the current page the project builder?
 *
 * @return bool
 */
function archlie_is_builder() {
	return is_page_template( ARCHLIE_BUILDER_TEMPLATE );
}

/**
 * URL of the project-builder page (falls back to /start/).
 *
 * @return string
 */
function archlie_start_url() {
	$page = get_page_by_path( 'start' );
	if ( $page ) {
		return get_permalink( $page );
	}
	return home_url( '/start/' );
}

/**
 * Enqueue assets. Onboarding CSS/JS load only on the builder page.
 */
function archlie_assets() {
	$dir = get_template_directory();
	$uri = get_template_directory_uri();

	wp_enqueue_style( 'archlie-fonts', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap', array(), null );

	$ver = function ( $rel ) use ( $dir ) {
		return file_exists( $dir . $rel ) ? filemtime( $dir . $rel ) : ARCHLIE_VERSION;
	};

	wp_enqueue_style( 'archlie-theme', $uri . '/assets/css/theme.css', array( 'archlie-fonts' ), $ver( '/assets/css/theme.css' ) );
	wp_enqueue_style( 'archlie-style', get_stylesheet_uri(), array( 'archlie-theme' ), ARCHLIE_VERSION );

	// Pricing model shared with the front-end (single source of truth).
	$t = archlie_pricing_table();
	$data = array(
		'packages'          => $t['packages'],
		'addons'            => $t['addons'],
		'revisionsIncluded' => $t['revisionsIncluded'],
		'deliveryDays'      => $t['deliveryDays'],
		'quoteValidityDays' => $t['quoteValidityDays'],
		'ribaEmail'         => $t['ribaEmail'],
		'ajaxUrl'           => admin_url( 'admin-ajax.php' ),
		'nonce'             => wp_create_nonce( 'archlie_intake' ),
		'startUrl'          => archlie_start_url(),
	);

	wp_enqueue_script( 'archlie-pricing', $uri . '/assets/js/pricing.js', array(), $ver( '/assets/js/pricing.js' ), true );
	wp_add_inline_script( 'archlie-pricing', 'window.ARCHLIE_WP = ' . wp_json_encode( $data ) . ';', 'before' );

	// Archie runs on the builder page and embedded on the front page.
	if ( archlie_is_builder() || is_front_page() ) {
		wp_enqueue_style( 'archlie-onboarding', $uri . '/assets/css/onboarding.css', array( 'archlie-theme' ), $ver( '/assets/css/onboarding.css' ) );
		wp_enqueue_script( 'archlie-onboarding', $uri . '/assets/js/onboarding.js', array( 'archlie-pricing' ), $ver( '/assets/js/onboarding.js' ), true );
	}
	// The homepage price grid + generic pages use app.js.
	if ( ! archlie_is_builder() ) {
		wp_enqueue_script( 'archlie-app', $uri . '/assets/js/app.js', array( 'archlie-pricing' ), $ver( '/assets/js/app.js' ), true );
	}
}
add_action( 'wp_enqueue_scripts', 'archlie_assets' );

/**
 * Fallback primary menu — the in-page section anchors.
 */
function archlie_primary_menu_fallback() {
	$items = array(
		home_url( '/#how' )      => __( 'How it works', 'archlie' ),
		home_url( '/#pricing' )  => __( 'Pricing', 'archlie' ),
		home_url( '/#services' ) => __( 'Services', 'archlie' ),
		home_url( '/#faq' )      => __( 'FAQ', 'archlie' ),
	);
	echo '<ul id="primary-menu" class="main-nav">';
	foreach ( $items as $href => $label ) {
		printf( '<li><a href="%s">%s</a></li>', esc_url( $href ), esc_html( $label ) );
	}
	echo '</ul>';
}

/**
 * Site logo: custom logo, or the stacked "Your Architect" wordmark.
 */
function archlie_logo() {
	if ( has_custom_logo() ) {
		the_custom_logo();
		return;
	}
	printf(
		'<a href="%s" class="logo" aria-label="%s"><span class="wordmark"><span>Your</span><span>Architect</span></span></a>',
		esc_url( home_url( '/' ) ),
		esc_attr__( 'Your Architect home', 'archlie' )
	);
}

/**
 * On activation, create the project-builder page if it doesn't exist.
 */
function archlie_create_builder_page() {
	if ( get_page_by_path( 'start' ) ) {
		return;
	}
	$id = wp_insert_post( array(
		'post_title'   => __( 'Start your project', 'archlie' ),
		'post_name'    => 'start',
		'post_status'  => 'publish',
		'post_type'    => 'page',
		'post_content' => '',
	) );
	if ( $id && ! is_wp_error( $id ) ) {
		update_post_meta( $id, '_wp_page_template', ARCHLIE_BUILDER_TEMPLATE );
	}
}
add_action( 'after_switch_theme', 'archlie_create_builder_page' );

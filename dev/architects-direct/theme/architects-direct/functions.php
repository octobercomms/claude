<?php
/**
 * Architects Direct theme bootstrap.
 *
 * @package Architects_Direct
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AD_THEME_VERSION', '1.0.0' );

require_once get_template_directory() . '/inc/pricing.php';
require_once get_template_directory() . '/inc/intake.php';
require_once get_template_directory() . '/inc/customizer.php';

/**
 * Theme setup.
 */
function ad_theme_setup() {
	load_theme_textdomain( 'architects-direct', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support(
		'html5',
		array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' )
	);
	add_theme_support(
		'custom-logo',
		array(
			'height'      => 48,
			'width'       => 48,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);

	register_nav_menus(
		array(
			'primary' => __( 'Primary menu', 'architects-direct' ),
			'footer'  => __( 'Footer menu', 'architects-direct' ),
		)
	);
}
add_action( 'after_setup_theme', 'ad_theme_setup' );

/**
 * Front-end assets.
 */
function ad_enqueue_assets() {
	$dir = get_template_directory();
	$uri = get_template_directory_uri();

	// Google Fonts (Archivo + Inter). Falls back to system sans if unavailable.
	wp_enqueue_style(
		'ad-fonts',
		'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap',
		array(),
		null
	);

	$css = '/assets/css/theme.css';
	wp_enqueue_style(
		'ad-theme',
		$uri . $css,
		array( 'ad-fonts' ),
		file_exists( $dir . $css ) ? filemtime( $dir . $css ) : AD_THEME_VERSION
	);

	// Ensure the required style.css header file is registered (WP convention).
	wp_enqueue_style( 'ad-style', get_stylesheet_uri(), array( 'ad-theme' ), AD_THEME_VERSION );

	$js = '/assets/js/app.js';
	wp_enqueue_script(
		'ad-app',
		$uri . $js,
		array(),
		file_exists( $dir . $js ) ? filemtime( $dir . $js ) : AD_THEME_VERSION,
		true
	);

	$table = ad_pricing_table();
	wp_localize_script(
		'ad-app',
		'ADData',
		array(
			'ajaxUrl'          => admin_url( 'admin-ajax.php' ),
			'nonce'            => wp_create_nonce( 'ad_intake' ),
			'prices'           => $table['services'],
			'bands'            => $table['bands'],
			'redirectOverBand' => $table['redirect_over_band'],
		)
	);
}
add_action( 'wp_enqueue_scripts', 'ad_enqueue_assets' );

/**
 * Fallback primary menu — the in-page section anchors, used until an admin
 * assigns a real menu to the "primary" location.
 */
function ad_primary_menu_fallback() {
	$items = array(
		'#how'      => __( 'How it works', 'architects-direct' ),
		'#services' => __( 'Services', 'architects-direct' ),
		'#pricing'  => __( 'Pricing', 'architects-direct' ),
		'#faq'      => __( 'FAQ', 'architects-direct' ),
	);
	echo '<ul id="primary-menu" class="main-nav">';
	foreach ( $items as $href => $label ) {
		printf( '<li><a href="%s">%s</a></li>', esc_attr( $href ), esc_html( $label ) );
	}
	echo '</ul>';
}

/**
 * Helper: echo the site logo (custom logo image, or the text lockup).
 */
function ad_site_logo() {
	if ( has_custom_logo() ) {
		the_custom_logo();
		return;
	}
	printf(
		'<a href="%1$s" class="logo" aria-label="%2$s"><span class="logo-mark">AD</span><span class="logo-text">Architects<span>Direct</span></span></a>',
		esc_url( home_url( '/' ) ),
		esc_attr__( 'Architects Direct home', 'architects-direct' )
	);
}

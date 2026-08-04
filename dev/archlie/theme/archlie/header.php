<?php
/**
 * Site header (radical restraint).
 *
 * @package Archlie
 */

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-head">
	<div class="band">
		<?php archlie_logo(); ?>
		<nav class="nav" aria-label="<?php esc_attr_e( 'Primary', 'archlie' ); ?>">
			<a class="navlink" href="<?php echo esc_url( home_url( '/#compare' ) ); ?>"><?php esc_html_e( 'Compare', 'archlie' ); ?></a>
			<a class="navlink" href="<?php echo esc_url( home_url( '/#how' ) ); ?>"><?php esc_html_e( 'How', 'archlie' ); ?></a>
			<a class="navlink" href="<?php echo esc_url( home_url( '/#pricing' ) ); ?>"><?php esc_html_e( 'Pricing', 'archlie' ); ?></a>
			<a class="navlink" href="<?php echo esc_url( home_url( '/#archie' ) ); ?>"><?php esc_html_e( 'Explore', 'archlie' ); ?></a>
			<a class="navlink" href="<?php echo esc_url( home_url( '/#faq' ) ); ?>"><?php esc_html_e( 'FAQ', 'archlie' ); ?></a>
			<a class="btn btn-primary" href="<?php echo esc_url( home_url( '/#archie' ) ); ?>"><?php esc_html_e( 'Start', 'archlie' ); ?></a>
		</nav>
	</div>
</header>

<?php
/**
 * Site header.
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

<header class="site-header" id="top">
	<div class="wrap header-inner">
		<?php archlie_logo(); ?>
		<nav class="main-nav-wrap" aria-label="<?php esc_attr_e( 'Primary', 'archlie' ); ?>">
			<?php
			wp_nav_menu( array(
				'theme_location' => 'primary',
				'container'      => false,
				'menu_class'     => 'main-nav',
				'menu_id'        => 'primary-menu',
				'fallback_cb'    => 'archlie_primary_menu_fallback',
				'depth'          => 1,
			) );
			?>
		</nav>
		<div class="header-cta">
			<span class="header-reg"><?php esc_html_e( 'ARB registered · RIBA chartered', 'archlie' ); ?></span>
			<a href="<?php echo esc_url( archlie_start_url() ); ?>" class="btn btn-primary btn-sm"><?php esc_html_e( 'Start your project', 'archlie' ); ?></a>
		</div>
	</div>
</header>

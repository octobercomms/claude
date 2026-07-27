<?php
/**
 * Site header.
 *
 * @package Architects_Direct
 */

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header" id="top">
	<div class="wrap header-inner">
		<?php ad_site_logo(); ?>

		<nav class="main-nav-wrap" aria-label="<?php esc_attr_e( 'Primary', 'architects-direct' ); ?>">
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'primary',
					'container'      => false,
					'menu_class'     => 'main-nav',
					'menu_id'        => 'primary-menu',
					'fallback_cb'    => 'ad_primary_menu_fallback',
					'depth'          => 1,
				)
			);
			?>
		</nav>

		<a href="#pricing" class="btn btn-primary btn-sm nav-cta"><?php esc_html_e( 'Get an instant price', 'architects-direct' ); ?></a>
	</div>
</header>

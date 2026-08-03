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
		<a href="<?php echo esc_url( home_url( '/#pricing' ) ); ?>" class="head-link"><?php esc_html_e( 'See pricing', 'archlie' ); ?></a>
	</div>
</header>

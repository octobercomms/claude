<?php
/**
 * Dashboard. Expects $banner_cb (callable), $plant_count (int), $by_api (array), $state (array).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-header">
		<img class="hgd-logo" src="<?php echo esc_url( HGD_URL . 'assets/img/logo.svg' ); ?>" alt="Hillcroft Gardens" />
		<p class="hgd-tagline"><?php esc_html_e( 'Straight-talking plant expertise. No hard sell, no guesswork.', 'hillcroft-garden-designer' ); ?></p>
	</div>

	<div class="hgd-cards">
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'Plants in catalogue', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $plant_count ) ); ?></span>
			<a class="hgd-pill" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-plants' ) ); ?>"><?php esc_html_e( 'Manage catalogue', 'hillcroft-garden-designer' ); ?></a>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'API spend this month', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure">£<?php echo esc_html( number_format( $state['spend'], 2 ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-settings' ) ); ?>"><?php esc_html_e( 'Cost settings', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</div>

	<div class="hgd-panel">
		<h2><?php esc_html_e( 'Build progress', 'hillcroft-garden-designer' ); ?></h2>
		<p class="hgd-muted"><?php esc_html_e( 'This is the foundation build. Live features arrive in subsequent updates — you will be able to install them with one click from the WordPress Updates screen.', 'hillcroft-garden-designer' ); ?></p>
		<ul class="hgd-checklist">
			<li class="done"><?php esc_html_e( 'Glossy admin + brand design system', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Plant catalogue database (add / edit / search)', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Cost & credits banner', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'One-click self-update from GitHub', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Lead capture & paid consultation booking', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Consultation capture + Claude sketch reading', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Gemini concept renders + render pack', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Pricing engine + proposals + milestone payments', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Client portal, plant book & seasonal film', 'hillcroft-garden-designer' ); ?></li>
		</ul>
	</div>

</div>

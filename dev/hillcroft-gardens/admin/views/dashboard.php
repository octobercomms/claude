<?php
/**
 * Dashboard. Expects $banner_cb, $plant_count, $project_count, $client_count, $state.
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
			<span class="hgd-card-label"><?php esc_html_e( 'Open projects', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $project_count ) ); ?></span>
			<a class="hgd-pill" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-projects' ) ); ?>"><?php esc_html_e( 'View projects', 'hillcroft-garden-designer' ); ?></a>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'Clients', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $client_count ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-clients' ) ); ?>"><?php esc_html_e( 'View clients', 'hillcroft-garden-designer' ); ?></a>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'Plants in catalogue', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $plant_count ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-plants' ) ); ?>"><?php esc_html_e( 'Manage catalogue', 'hillcroft-garden-designer' ); ?></a>
		</div>
		<div class="hgd-card">
			<span class="hgd-card-label"><?php esc_html_e( 'API spend this month', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure">£<?php echo esc_html( number_format( $state['spend'], 2 ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-settings' ) ); ?>"><?php esc_html_e( 'Cost settings', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</div>

	<div class="hgd-panel">
		<h2><?php esc_html_e( 'Capturing leads', 'hillcroft-garden-designer' ); ?></h2>
		<p class="hgd-muted"><?php esc_html_e( 'Build a multi-step enquiry form under Forms, then embed it on any page with its shortcode. Completed forms create a client and a project automatically and email you a notification.', 'hillcroft-garden-designer' ); ?></p>
		<p><code class="hgd-code">[hgd_form id="123"]</code> &nbsp; <span class="hgd-muted"><?php esc_html_e( 'or the quick fixed form:', 'hillcroft-garden-designer' ); ?> <code class="hgd-code">[hgd_enquiry]</code></span></p>
	</div>

	<div class="hgd-panel">
		<h2><?php esc_html_e( 'Build progress', 'hillcroft-garden-designer' ); ?></h2>
		<p class="hgd-muted"><?php esc_html_e( 'Features arrive as one-click updates from the WordPress Updates screen.', 'hillcroft-garden-designer' ); ?></p>
		<ul class="hgd-checklist">
			<li class="done"><?php esc_html_e( 'Glossy admin + brand design system', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Plant catalogue database', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Cost & credits banner', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'One-click self-update from GitHub', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Projects, clients (CRM) & lead-capture form', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Paid £200 consultation booking + calendar', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Consultation capture + Claude sketch reading', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Gemini concept renders + render pack', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Pricing engine + proposals + milestone payments', 'hillcroft-garden-designer' ); ?></li>
			<li><?php esc_html_e( 'Client portal, plant book & seasonal film', 'hillcroft-garden-designer' ); ?></li>
		</ul>
	</div>

</div>

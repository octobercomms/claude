<?php
/**
 * Dashboard. Expects $banner_cb, $plant_count, $project_count, $client_count, $upcoming_count, $state.
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
			<span class="hgd-card-label"><?php esc_html_e( 'Upcoming consultations', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure"><?php echo esc_html( number_format( $upcoming_count ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-bookings' ) ); ?>"><?php esc_html_e( 'View bookings', 'hillcroft-garden-designer' ); ?></a>
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
		<div class="hgd-card hgd-card--accent">
			<span class="hgd-card-label"><?php esc_html_e( 'API spend this month', 'hillcroft-garden-designer' ); ?></span>
			<span class="hgd-card-figure">£<?php echo esc_html( number_format( $state['spend'], 2 ) ); ?></span>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-settings' ) ); ?>"><?php esc_html_e( 'Cost settings', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</div>

	<?php $hgd_example_exists = HGD_Demo::exists(); ?>
	<div class="hgd-panel">
		<h2><?php esc_html_e( 'Try a worked example', 'hillcroft-garden-designer' ); ?></h2>
		<?php if ( $hgd_example_exists ) : ?>
			<p class="hgd-muted"><?php esc_html_e( 'An example project is ready to explore — a complete, clickable demo with placeholder images and no API calls.', 'hillcroft-garden-designer' ); ?></p>
			<p>
				<a class="hgd-pill" href="<?php echo esc_url( add_query_arg( array( 'page' => 'hgd-projects', 'action' => 'edit', 'id' => HGD_Demo::project_id() ), admin_url( 'admin.php' ) ) ); ?>"><?php esc_html_e( 'Open the example', 'hillcroft-garden-designer' ); ?></a>
				<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( admin_url( 'admin.php?page=hgd-projects' ) ); ?>"><?php esc_html_e( 'Manage from Projects', 'hillcroft-garden-designer' ); ?></a>
			</p>
		<?php else : ?>
			<p class="hgd-muted"><?php esc_html_e( 'Spin up a complete, realistic example project in one click and explore the whole journey — capture, design, render pack, pricing and proposal. It uses placeholder images and makes no API calls (zero cost), and you can remove it any time.', 'hillcroft-garden-designer' ); ?></p>
			<p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="hgd_create_example" />
					<?php wp_nonce_field( 'hgd_create_example' ); ?>
					<button type="submit" class="hgd-pill"><?php esc_html_e( 'Create example project', 'hillcroft-garden-designer' ); ?></button>
				</form>
			</p>
		<?php endif; ?>
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
			<li class="done"><?php esc_html_e( 'Forms builder (multi-step, submissions, analytics)', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Paid £200 consultation booking + Google Calendar', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Consultation capture + Claude sketch reading', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Gemini concept renders (iterate)', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Pricing engine (Good / Better / Best quotes)', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Proposals, client portal & milestone payments', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Render pack (named views, satellite & seasons)', 'hillcroft-garden-designer' ); ?></li>
			<li class="done"><?php esc_html_e( 'Plant book & seasonal film', 'hillcroft-garden-designer' ); ?></li>
		</ul>
	</div>

</div>

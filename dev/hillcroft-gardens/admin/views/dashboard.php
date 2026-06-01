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

	<div class="hgd-panel hgd-workflow-panel">
		<h2><?php esc_html_e( 'How it works', 'hillcroft-garden-designer' ); ?></h2>
		<p class="hgd-muted"><?php esc_html_e( 'Every garden flows through the same journey — from first enquiry to a signed, paid proposal and the keepsakes that delight the client.', 'hillcroft-garden-designer' ); ?></p>

		<?php
		$flow = array(
			array(
				'icon' => '<path d="M3 7h18M3 12h18M3 17h12"/>',
				'title' => __( 'Enquiry & booking', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Lead form or paid £200 consultation', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-bookings' ),
			),
			array(
				'icon' => '<path d="M4 16l4.5-9 3 6 2.5-4 6 7z"/><circle cx="8" cy="6" r="1.5"/>',
				'title' => __( 'Capture', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Sketch, photos & address', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
			array(
				'icon' => '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0"/>',
				'title' => __( 'Claude reads it', 'hillcroft-garden-designer' ),
				'desc'  => __( 'AI interprets the sketch & dimensions', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
			array(
				'icon' => '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
				'title' => __( 'Design & renders', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Gemini concept images, iterate', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
			array(
				'icon' => '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
				'title' => __( 'Render pack', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Masterplan, corners, seasons', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
			array(
				'icon' => '<path d="M12 3v18"/><path d="M7 7h7a3 3 0 0 1 0 6H7m0 0h8"/>',
				'title' => __( 'Pricing', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Good / Better / Best from the catalogue', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-plants' ),
			),
			array(
				'icon' => '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
				'title' => __( 'Proposal & portal', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Client reviews, e-signs & pays', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
			array(
				'icon' => '<path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11"/><path d="M4 19a2 2 0 0 1 2-2h14"/><path d="M9 8h4"/>',
				'title' => __( 'Payment & keepsakes', 'hillcroft-garden-designer' ),
				'desc'  => __( 'Deposit, plant book & seasonal film', 'hillcroft-garden-designer' ),
				'url'   => admin_url( 'admin.php?page=hgd-projects' ),
			),
		);
		$total = count( $flow );
		?>
		<div class="hgd-flow">
			<?php foreach ( $flow as $i => $step ) : ?>
				<a class="hgd-flow-step" href="<?php echo esc_url( $step['url'] ); ?>">
					<span class="hgd-flow-num"><?php echo esc_html( $i + 1 ); ?></span>
					<span class="hgd-flow-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><?php echo $step['icon']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — static inline SVG paths ?></svg>
					</span>
					<span class="hgd-flow-title"><?php echo esc_html( $step['title'] ); ?></span>
					<span class="hgd-flow-desc"><?php echo esc_html( $step['desc'] ); ?></span>
				</a>
				<?php if ( $i < $total - 1 ) : ?>
					<span class="hgd-flow-arrow" aria-hidden="true">→</span>
				<?php endif; ?>
			<?php endforeach; ?>
		</div>

		<p class="hgd-muted hgd-flow-foot"><?php esc_html_e( 'New here? Create the example project above to click through the whole journey with sample data.', 'hillcroft-garden-designer' ); ?></p>
	</div>

</div>

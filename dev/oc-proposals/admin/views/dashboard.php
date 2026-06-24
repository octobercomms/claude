<?php
/**
 * Admin dashboard — foundation. Feature tiles light up as later PRs land.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap ocp-wrap">
	<h1 class="ocp-h1"><?php esc_html_e( 'October Proposals', 'oc-proposals' ); ?></h1>
	<p class="ocp-lede"><?php esc_html_e( 'Build on-brand proposals as a web page and a downloadable PDF, from one source.', 'oc-proposals' ); ?></p>

	<div class="ocp-grid">
		<div class="ocp-card">
			<h2><?php esc_html_e( 'Proposals', 'oc-proposals' ); ?></h2>
			<p class="ocp-muted"><?php esc_html_e( 'Build a proposal in the wizard, then share the private link.', 'oc-proposals' ); ?></p>
			<a class="ocp-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=oc-proposals-list' ) ); ?>"><?php esc_html_e( 'Open proposals', 'oc-proposals' ); ?></a>
		</div>
		<div class="ocp-card">
			<h2><?php esc_html_e( 'Pipeline (CRM)', 'oc-proposals' ); ?></h2>
			<p class="ocp-muted"><?php esc_html_e( 'Lead pipeline modelled on the Sales Leads Tracker, with import.', 'oc-proposals' ); ?></p>
			<a class="ocp-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=ocp-crm' ) ); ?>"><?php esc_html_e( 'Open pipeline', 'oc-proposals' ); ?></a>
		</div>
		<div class="ocp-card">
			<h2><?php esc_html_e( 'Library', 'oc-proposals' ); ?></h2>
			<p class="ocp-muted"><?php esc_html_e( 'Case studies, testimonials, services, awards and clients.', 'oc-proposals' ); ?></p>
			<a class="ocp-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=ocp-library' ) ); ?>"><?php esc_html_e( 'Open library', 'oc-proposals' ); ?></a>
		</div>
		<div class="ocp-card ocp-card--accent">
			<h2><?php esc_html_e( 'Set up', 'oc-proposals' ); ?></h2>
			<p class="ocp-muted"><?php esc_html_e( 'Add your brand tokens, company details and integration keys.', 'oc-proposals' ); ?></p>
			<a class="ocp-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=ocp-settings' ) ); ?>"><?php esc_html_e( 'Open settings', 'oc-proposals' ); ?></a>
		</div>
	</div>

	<p class="ocp-foot ocp-muted">
		<?php
		/* translators: %s version */
		printf( esc_html__( 'October Proposals v%s — installs once, updates in place from GitHub releases.', 'oc-proposals' ), esc_html( OCP_VERSION ) );
		?>
	</p>
</div>

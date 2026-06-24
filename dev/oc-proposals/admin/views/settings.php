<?php
/**
 * Settings screen — brand tokens, company details, commercial defaults, keys.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$s = OCP_Settings::all();

/** Small helper to render a labelled text field. */
$field = function ( $key, $label, $type = 'text', $note = '' ) use ( $s ) {
	$id = 'ocp_' . $key;
	echo '<tr><th scope="row"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label></th><td>';
	printf(
		'<input type="%s" id="%s" name="%s" value="%s" class="regular-text" />',
		esc_attr( $type ),
		esc_attr( $id ),
		esc_attr( $key ),
		esc_attr( (string) $s[ $key ] )
	);
	if ( $note ) {
		echo '<p class="description">' . esc_html( $note ) . '</p>';
	}
	echo '</td></tr>';
};
?>
<div class="wrap ocp-wrap">
	<h1 class="ocp-h1"><?php esc_html_e( 'October Proposals — Settings', 'oc-proposals' ); ?></h1>

	<?php if ( ! empty( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'oc-proposals' ); ?></p></div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="ocp_save_settings" />
		<?php wp_nonce_field( 'ocp_save_settings' ); ?>

		<h2><?php esc_html_e( 'Brand & design tokens', 'oc-proposals' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Defaults match the OMI design system. Change fonts and colours to re-skin everything — web, PDF and admin.', 'oc-proposals' ); ?></p>
		<table class="form-table" role="presentation">
			<?php
			$field( 'font_family', __( 'Font family', 'oc-proposals' ) );
			$field( 'color_page', __( 'Page background', 'oc-proposals' ) );
			$field( 'color_ink', __( 'Text (ink)', 'oc-proposals' ) );
			$field( 'color_accent', __( 'Accent', 'oc-proposals' ) );
			$field( 'color_accent_on', __( 'Text on accent', 'oc-proposals' ) );
			$field( 'color_border', __( 'Border (thick)', 'oc-proposals' ) );
			$field( 'color_card', __( 'Card border (soft)', 'oc-proposals' ) );
			$field( 'logo_url', __( 'October logo URL', 'oc-proposals' ), 'url' );
			?>
		</table>

		<h2><?php esc_html_e( 'Company & legal', 'oc-proposals' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$field( 'company_name', __( 'Company name', 'oc-proposals' ) );
			$field( 'company_legal', __( 'Legal line', 'oc-proposals' ) );
			$field( 'company_address', __( 'Registered address', 'oc-proposals' ) );
			$field( 'company_email', __( 'Contact email', 'oc-proposals' ), 'email' );
			$field( 'company_site', __( 'Website', 'oc-proposals' ) );
			?>
		</table>

		<h2><?php esc_html_e( 'Commercial defaults', 'oc-proposals' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$field( 'default_currency', __( 'Default currency', 'oc-proposals' ), 'text', __( 'GBP, USD or EUR. US clients default to USD; VAT is applied silently when it applies.', 'oc-proposals' ) );
			$field( 'vat_rate', __( 'VAT rate (%)', 'oc-proposals' ), 'number' );
			?>
		</table>

		<h2><?php esc_html_e( 'Pricing rate card', 'oc-proposals' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Grounds the “Suggest pricing with Claude” assistant. It must stay within these bands — so it can never propose an out-of-range fee.', 'oc-proposals' ); ?></p>
		<table class="form-table" role="presentation">
			<?php
			$field( 'hourly_rate', __( 'Hourly rate', 'oc-proposals' ), 'number' );
			$field( 'band_oneoff_min', __( 'One-off min', 'oc-proposals' ), 'number' );
			$field( 'band_oneoff_max', __( 'One-off max', 'oc-proposals' ), 'number' );
			$field( 'band_monthly_min', __( 'Monthly min', 'oc-proposals' ), 'number' );
			$field( 'band_monthly_max', __( 'Monthly max', 'oc-proposals' ), 'number' );
			$field( 'band_project_min', __( 'Project min', 'oc-proposals' ), 'number' );
			$field( 'band_project_max', __( 'Project max', 'oc-proposals' ), 'number' );
			?>
		</table>

		<h2><?php esc_html_e( 'Conversion & automation', 'oc-proposals' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$field( 'booking_url', __( 'Kickoff booking URL', 'oc-proposals' ), 'url', __( 'Your scheduler link (Calendly, cal.com, Google). Shown as “Book a kickoff call”.', 'oc-proposals' ) );
			$field( 'followup_days', __( 'Follow-up after (days)', 'oc-proposals' ), 'number', __( 'Days after sending to email an un-accepted proposal a reminder.', 'oc-proposals' ) );
			$field( 'followup_enabled', __( 'Follow-ups on (1/0)', 'oc-proposals' ), 'number' );
			$field( 'report_email_enabled', __( 'Email me monthly/annual reports (1/0)', 'oc-proposals' ), 'number' );
			?>
		</table>

		<h2><?php esc_html_e( 'Integrations', 'oc-proposals' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Stored per-site, never committed. The GitHub token (Contents: read on this repo) powers one-click self-updates.', 'oc-proposals' ); ?></p>
		<table class="form-table" role="presentation">
			<?php
			$field( 'github_token', __( 'GitHub token', 'oc-proposals' ), 'password', __( 'Fine-grained token, owner octobercomms, Contents: read.', 'oc-proposals' ) );
			$field( 'claude_key', __( 'Claude API key', 'oc-proposals' ), 'password' );
			$field( 'stripe_secret', __( 'Stripe secret key', 'oc-proposals' ), 'password' );
			$field( 'stripe_public', __( 'Stripe publishable key', 'oc-proposals' ) );
			$field( 'gocardless_token', __( 'GoCardless access token', 'oc-proposals' ), 'password' );
			$field( 'clarity_id', __( 'Microsoft Clarity ID', 'oc-proposals' ) );
			$field( 'turnstile_site', __( 'Cloudflare Turnstile site key', 'oc-proposals' ) );
			$field( 'turnstile_secret', __( 'Cloudflare Turnstile secret', 'oc-proposals' ), 'password' );
			?>
		</table>

		<?php submit_button( __( 'Save settings', 'oc-proposals' ) ); ?>
	</form>
</div>

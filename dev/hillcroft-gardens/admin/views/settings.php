<?php
/**
 * Settings. Expects $banner_cb, $s (settings array), $saved (bool).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$secret_ph = '••••••••••••';
$field = function ( $key, $label, $type = 'text', $attrs = '' ) use ( $s, $secret_ph ) {
	$is_secret = HGD_Settings::is_secret( $key );
	$value     = isset( $s[ $key ] ) ? $s[ $key ] : '';
	$display   = ( $is_secret && '' !== $value ) ? '' : $value;
	$ph        = ( $is_secret && '' !== $value ) ? $secret_ph : '';
	printf(
		'<label><span>%s</span><input type="%s" name="%s" value="%s" placeholder="%s" %s autocomplete="off" /></label>',
		esc_html( $label ),
		esc_attr( $type ),
		esc_attr( $key ),
		esc_attr( $display ),
		esc_attr( $ph ),
		$attrs // already-trusted attribute string
	);
};
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head"><h1><?php esc_html_e( 'Settings', 'hillcroft-garden-designer' ); ?></h1></div>

	<?php if ( $saved ) : ?>
		<div class="hgd-flash"><?php esc_html_e( 'Settings saved.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="hgd_save_settings" />
		<?php wp_nonce_field( 'hgd_save_settings' ); ?>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'API keys', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Stored on this site. Leave a field blank to keep the existing key.', 'hillcroft-garden-designer' ); ?></p>
			<div class="hgd-grid">
				<?php
				$field( 'claude_api_key', __( 'Claude API key', 'hillcroft-garden-designer' ) );
				$field( 'gemini_api_key', __( 'Google Gemini API key', 'hillcroft-garden-designer' ) );
				$field( 'google_maps_api_key', __( 'Google Maps API key', 'hillcroft-garden-designer' ) );
				$field( 'plantid_api_key', __( 'Plant.id / Kindwise API key', 'hillcroft-garden-designer' ) );
				$field( 'stripe_secret_key', __( 'Stripe secret key', 'hillcroft-garden-designer' ) );
				$field( 'stripe_pub_key', __( 'Stripe publishable key', 'hillcroft-garden-designer' ) );
				?>
			</div>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Updates', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Connect to the private GitHub repository so this plugin can update itself from the WordPress Updates screen — no manual uploads.', 'hillcroft-garden-designer' ); ?></p>
			<div class="hgd-grid">
				<?php
				$field( 'github_repo', __( 'Repository (owner/repo)', 'hillcroft-garden-designer' ) );
				$field( 'github_token', __( 'GitHub access token', 'hillcroft-garden-designer' ) );
				$field( 'github_tag_prefix', __( 'Release tag prefix', 'hillcroft-garden-designer' ) );
				?>
				<label class="hgd-checkbox"><input type="checkbox" name="auto_update" value="1" <?php checked( ! empty( $s['auto_update'] ) ); ?> /> <span><?php esc_html_e( 'Enable automatic background updates', 'hillcroft-garden-designer' ); ?></span></label>
			</div>
			<p class="hgd-muted"><?php echo esc_html( sprintf( /* translators: %s version */ __( 'Installed version: %s', 'hillcroft-garden-designer' ), HGD_VERSION ) ); ?></p>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Cost tracking', 'hillcroft-garden-designer' ); ?></h2>
			<div class="hgd-grid">
				<?php
				$field( 'soft_monthly_cap_gbp', __( 'Soft monthly spend cap (£)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0"' );
				$field( 'plantid_credits_balance', __( 'Plant-ID credits remaining', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0"' );
				$field( 'usd_to_gbp', __( 'USD → GBP rate', 'hillcroft-garden-designer' ), 'number', 'step="0.01" min="0"' );
				$field( 'eur_to_gbp', __( 'EUR → GBP rate', 'hillcroft-garden-designer' ), 'number', 'step="0.01" min="0"' );
				$field( 'rate_claude_per_mtok_usd', __( 'Claude ($/M tokens)', 'hillcroft-garden-designer' ), 'number', 'step="0.01" min="0"' );
				$field( 'rate_gemini_per_image_usd', __( 'Gemini ($/image)', 'hillcroft-garden-designer' ), 'number', 'step="0.001" min="0"' );
				$field( 'rate_maps_per_1k_usd', __( 'Maps ($/1k calls)', 'hillcroft-garden-designer' ), 'number', 'step="0.01" min="0"' );
				$field( 'rate_plantid_per_credit_eur', __( 'Plant.id (€/credit)', 'hillcroft-garden-designer' ), 'number', 'step="0.001" min="0"' );
				?>
			</div>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Business defaults', 'hillcroft-garden-designer' ); ?></h2>
			<div class="hgd-grid">
				<?php
				$field( 'consultation_fee_gbp', __( 'Consultation fee (£)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0"' );
				$field( 'deposit_pct', __( 'Deposit on signing (%)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0" max="100"' );
				$field( 'commencement_pct', __( 'On commencement (%)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0" max="100"' );
				$field( 'completion_pct', __( 'On completion (%)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0" max="100"' );
				?>
			</div>
			<p class="hgd-muted"><?php esc_html_e( 'The consultation fee is charged separately and is never deducted from the project total.', 'hillcroft-garden-designer' ); ?></p>
		</div>

		<div class="hgd-panel">
			<h2><?php esc_html_e( 'Brand colours', 'hillcroft-garden-designer' ); ?></h2>
			<div class="hgd-grid">
				<?php
				$field( 'brand_olive', __( 'Olive (brand)', 'hillcroft-garden-designer' ) );
				$field( 'brand_charcoal', __( 'Charcoal', 'hillcroft-garden-designer' ) );
				$field( 'brand_cream', __( 'Cream', 'hillcroft-garden-designer' ) );
				?>
			</div>
		</div>

		<div class="hgd-form-actions">
			<button type="submit" class="hgd-pill"><?php esc_html_e( 'Save settings', 'hillcroft-garden-designer' ); ?></button>
		</div>
	</form>

</div>

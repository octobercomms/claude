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

	<?php
	$google_state = isset( $_GET['google'] ) ? sanitize_key( $_GET['google'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
	if ( 'connected' === $google_state ) : ?>
		<div class="hgd-flash"><?php esc_html_e( 'Google Calendar connected.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( 'disconnected' === $google_state ) : ?>
		<div class="hgd-flash"><?php esc_html_e( 'Google Calendar disconnected.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( 'denied' === $google_state ) : ?>
		<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Google access was declined.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( 'error' === $google_state ) : ?>
		<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Could not connect Google Calendar. Check the client id/secret and try again.', 'hillcroft-garden-designer' ); ?></div>
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
				$field( 'stripe_webhook_secret', __( 'Stripe webhook signing secret', 'hillcroft-garden-designer' ) );
				?>
			</div>
			<h3><?php esc_html_e( 'AI', 'hillcroft-garden-designer' ); ?></h3>
			<div class="hgd-grid">
				<?php $field( 'claude_model', __( 'Claude model', 'hillcroft-garden-designer' ) ); ?>
			</div>
			<p class="hgd-muted"><?php esc_html_e( 'Used for consultation sketch-reading. Default: claude-sonnet-4-6', 'hillcroft-garden-designer' ); ?></p>
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
			<h2><?php esc_html_e( 'Booking &amp; calendar', 'hillcroft-garden-designer' ); ?></h2>
			<p class="hgd-muted"><?php esc_html_e( 'Embed the public booking form on any page with this shortcode:', 'hillcroft-garden-designer' ); ?> <code class="hgd-code">[hgd_booking]</code></p>

			<h3><?php esc_html_e( 'Google Calendar (optional)', 'hillcroft-garden-designer' ); ?></h3>
			<p class="hgd-muted"><?php esc_html_e( 'Connect a personal Gmail calendar to hide clashing times and auto-add paid consultations. Booking works fine without this.', 'hillcroft-garden-designer' ); ?></p>
			<div class="hgd-grid">
				<?php
				$field( 'google_client_id', __( 'Google OAuth client ID', 'hillcroft-garden-designer' ) );
				$field( 'google_client_secret', __( 'Google OAuth client secret', 'hillcroft-garden-designer' ) );
				$field( 'google_calendar_id', __( 'Calendar ID (or “primary”)', 'hillcroft-garden-designer' ) );
				?>
			</div>
			<p class="hgd-muted">
				<?php
				printf(
					/* translators: %s redirect URI */
					esc_html__( 'Authorised redirect URI for your Google OAuth client: %s', 'hillcroft-garden-designer' ),
					'<code class="hgd-code">' . esc_html( HGD_Google_Calendar::redirect_uri() ) . '</code>'
				);
				?>
			</p>
			<p>
				<?php if ( HGD_Google_Calendar::is_connected() ) : ?>
					<span class="hgd-status hgd-status-booked"><?php esc_html_e( 'Connected', 'hillcroft-garden-designer' ); ?></span>
					&nbsp;
					<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( wp_nonce_url( add_query_arg( 'action', 'hgd_google_disconnect', admin_url( 'admin-post.php' ) ), 'hgd_google_disconnect' ) ); ?>"><?php esc_html_e( 'Disconnect', 'hillcroft-garden-designer' ); ?></a>
				<?php elseif ( '' !== $s['google_client_id'] && '' !== $s['google_client_secret'] ) : ?>
					<span class="hgd-status hgd-status-lead"><?php esc_html_e( 'Not connected', 'hillcroft-garden-designer' ); ?></span>
					&nbsp;
					<a class="hgd-pill" href="<?php echo esc_url( HGD_Google_Calendar::auth_url() ); ?>"><?php esc_html_e( 'Connect Google Calendar', 'hillcroft-garden-designer' ); ?></a>
					<span class="hgd-muted"><?php esc_html_e( '(save the client id/secret first)', 'hillcroft-garden-designer' ); ?></span>
				<?php else : ?>
					<span class="hgd-muted"><?php esc_html_e( 'Enter and save a client id and secret to enable the connect button.', 'hillcroft-garden-designer' ); ?></span>
				<?php endif; ?>
			</p>

			<h3><?php esc_html_e( 'Availability', 'hillcroft-garden-designer' ); ?></h3>
			<?php
			$selected_days = array_filter( array_map( 'intval', explode( ',', (string) $s['avail_days'] ) ) );
			$day_names     = array(
				1 => __( 'Mon', 'hillcroft-garden-designer' ),
				2 => __( 'Tue', 'hillcroft-garden-designer' ),
				3 => __( 'Wed', 'hillcroft-garden-designer' ),
				4 => __( 'Thu', 'hillcroft-garden-designer' ),
				5 => __( 'Fri', 'hillcroft-garden-designer' ),
				6 => __( 'Sat', 'hillcroft-garden-designer' ),
				7 => __( 'Sun', 'hillcroft-garden-designer' ),
			);
			?>
			<p class="hgd-muted"><?php esc_html_e( 'Days you take consultations:', 'hillcroft-garden-designer' ); ?></p>
			<p class="hgd-booking-days">
				<?php foreach ( $day_names as $num => $label ) : ?>
					<label class="hgd-checkbox" style="display:inline-flex;margin-right:14px;">
						<input type="checkbox" name="avail_days[]" value="<?php echo esc_attr( $num ); ?>" <?php checked( in_array( $num, $selected_days, true ) ); ?> />
						<span><?php echo esc_html( $label ); ?></span>
					</label>
				<?php endforeach; ?>
			</p>
			<div class="hgd-grid">
				<?php
				$field( 'avail_start', __( 'Day starts (HH:MM)', 'hillcroft-garden-designer' ), 'time' );
				$field( 'avail_end', __( 'Day ends (HH:MM)', 'hillcroft-garden-designer' ), 'time' );
				$field( 'slot_minutes', __( 'Slot length (minutes)', 'hillcroft-garden-designer' ), 'number', 'step="5" min="15"' );
				$field( 'buffer_minutes', __( 'Buffer between slots (minutes)', 'hillcroft-garden-designer' ), 'number', 'step="5" min="0"' );
				$field( 'booking_lead_days', __( 'Earliest booking (days ahead)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="0"' );
				$field( 'booking_window_days', __( 'Booking window (days ahead)', 'hillcroft-garden-designer' ), 'number', 'step="1" min="1"' );
				?>
			</div>
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

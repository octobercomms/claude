<?php
/**
 * Settings / status page view.
 *
 * Variables in scope (set by OctoberMI_Admin::render_page):
 *   $settings   array  Decrypted settings.
 *   $connected  bool   Whether the site is paired.
 *   $log        array  Rolling outbound-call log, newest first.
 *   $notice     string Flash message to display.
 *   $notice_ok  bool   Whether the flash message is a success.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Count events pushed this month from the rolling log (best-effort; the log is
// capped at 50, so this is "of the recent calls"). The lifetime total comes
// from the counter.
$month_start = strtotime( gmdate( 'Y-m-01 00:00:00' ) );
$this_month  = 0;
foreach ( $log as $entry ) {
	if ( ! empty( $entry['time'] ) && (int) $entry['time'] >= $month_start ) {
		$this_month++;
	}
}
?>
<div class="wrap octobermi-wrap">
	<h1><?php esc_html_e( 'October Marketing Intelligence', 'october-mi' ); ?></h1>
	<p class="octobermi-tagline">
		<?php esc_html_e( 'Your site sends commerce, content and SEO signals outbound to the October platform. Nothing inbound is required, so firewalls never get in the way.', 'october-mi' ); ?>
	</p>

	<?php if ( '' !== $notice ) : ?>
		<div class="notice <?php echo $notice_ok ? 'notice-success' : 'notice-error'; ?> is-dismissible">
			<p><?php echo esc_html( $notice ); ?></p>
		</div>
	<?php endif; ?>

	<?php if ( ! $connected ) : ?>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Connect this site', 'october-mi' ); ?></h2>
			<p><?php esc_html_e( 'Paste the 24-character pairing token from your October dashboard, then connect. The site makes a single outbound request to pair.', 'october-mi' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="octobermi_connect" />
				<?php wp_nonce_field( 'octobermi_connect' ); ?>
				<p>
					<label for="octobermi_token"><strong><?php esc_html_e( 'Pairing token', 'october-mi' ); ?></strong></label><br />
					<input type="text" id="octobermi_token" name="octobermi_token" class="regular-text" autocomplete="off"
						maxlength="24" pattern="[A-Za-z0-9]{24}" placeholder="<?php esc_attr_e( '24 letters and numbers', 'october-mi' ); ?>" required />
				</p>
				<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Connect', 'october-mi' ); ?></button></p>
			</form>
		</div>

	<?php else : ?>

		<div class="octobermi-card octobermi-status">
			<h2><?php esc_html_e( 'Status', 'october-mi' ); ?></h2>
			<ul class="octobermi-stats">
				<li>
					<span class="octobermi-stat-label"><?php esc_html_e( 'Connected to', 'october-mi' ); ?></span>
					<span class="octobermi-stat-value">
						<?php echo esc_html( $settings['client_name'] ? $settings['client_name'] : $settings['client_id'] ); ?>
					</span>
				</li>
				<li>
					<span class="octobermi-stat-label"><?php esc_html_e( 'Last sync', 'october-mi' ); ?></span>
					<span class="octobermi-stat-value">
						<?php
						echo $settings['last_sync']
							? esc_html( human_time_diff( (int) $settings['last_sync'], time() ) . ' ' . __( 'ago', 'october-mi' ) )
							: esc_html__( 'No events sent yet', 'october-mi' );
						?>
					</span>
				</li>
				<li>
					<span class="octobermi-stat-label"><?php esc_html_e( 'Events this month', 'october-mi' ); ?></span>
					<span class="octobermi-stat-value"><?php echo esc_html( number_format_i18n( $this_month ) ); ?></span>
				</li>
				<li>
					<span class="octobermi-stat-label"><?php esc_html_e( 'Events all time', 'october-mi' ); ?></span>
					<span class="octobermi-stat-value"><?php echo esc_html( number_format_i18n( (int) $settings['events_total'] ) ); ?></span>
				</li>
			</ul>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( 'Reset the connection? The site will stop sending events until you pair again.', 'october-mi' ) ); ?>');">
				<input type="hidden" name="action" value="octobermi_reset" />
				<?php wp_nonce_field( 'octobermi_reset' ); ?>
				<button type="submit" class="button"><?php esc_html_e( 'Reset connection', 'october-mi' ); ?></button>
			</form>
		</div>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Recent activity', 'october-mi' ); ?></h2>
			<p class="description"><?php esc_html_e( 'The last 50 outbound calls to the platform.', 'october-mi' ); ?></p>
			<?php if ( empty( $log ) ) : ?>
				<p><em><?php esc_html_e( 'No outbound calls recorded yet.', 'october-mi' ); ?></em></p>
			<?php else : ?>
				<table class="widefat striped octobermi-log">
					<thead>
						<tr>
							<th><?php esc_html_e( 'When', 'october-mi' ); ?></th>
							<th><?php esc_html_e( 'Event', 'october-mi' ); ?></th>
							<th><?php esc_html_e( 'Endpoint', 'october-mi' ); ?></th>
							<th><?php esc_html_e( 'Result', 'october-mi' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $log as $entry ) : ?>
							<tr>
								<td><?php echo esc_html( human_time_diff( (int) $entry['time'], time() ) . ' ' . __( 'ago', 'october-mi' ) ); ?></td>
								<td><?php echo esc_html( $entry['event'] ); ?></td>
								<td><code><?php echo esc_html( $entry['endpoint'] ); ?></code></td>
								<td>
									<?php if ( ! empty( $entry['ok'] ) ) : ?>
										<span class="octobermi-ok"><?php echo $entry['status'] ? esc_html( $entry['status'] ) : esc_html__( 'sent', 'october-mi' ); ?></span>
									<?php else : ?>
										<span class="octobermi-fail"><?php echo $entry['status'] ? esc_html( $entry['status'] ) : esc_html__( 'failed', 'october-mi' ); ?></span>
										<?php if ( ! empty( $entry['note'] ) ) : ?>
											<small><?php echo esc_html( $entry['note'] ); ?></small>
										<?php endif; ?>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:12px;">
					<input type="hidden" name="action" value="octobermi_clear_log" />
					<?php wp_nonce_field( 'octobermi_clear_log' ); ?>
					<button type="submit" class="button button-link-delete"><?php esc_html_e( 'Clear log', 'october-mi' ); ?></button>
				</form>
			<?php endif; ?>
		</div>

	<?php endif; ?>

	<div class="octobermi-card">
		<h2><?php esc_html_e( 'Automatic updates', 'october-mi' ); ?></h2>
		<p class="description">
			<?php esc_html_e( 'Add a GitHub fine-grained token (Contents: read) so the plugin can update itself from the October release feed.', 'october-mi' ); ?>
		</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="octobermi_save_token" />
			<?php wp_nonce_field( 'octobermi_save_token' ); ?>
			<p>
				<label for="octobermi_github_token"><strong><?php esc_html_e( 'Update token', 'october-mi' ); ?></strong></label><br />
				<input type="password" id="octobermi_github_token" name="octobermi_github_token" class="regular-text" autocomplete="off"
					placeholder="<?php echo ! empty( $settings['github_token'] ) ? '********' : 'github_pat_…'; ?>" />
			</p>
			<p>
				<button type="submit" class="button"><?php esc_html_e( 'Save token', 'october-mi' ); ?></button>
			</p>
		</form>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="octobermi_test_update" />
			<?php wp_nonce_field( 'octobermi_test_update' ); ?>
			<button type="submit" class="button"><?php esc_html_e( 'Test update connection', 'october-mi' ); ?></button>
		</form>
	</div>
</div>

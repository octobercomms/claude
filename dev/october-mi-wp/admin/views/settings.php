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

$connect_enabled = OctoberMI_Settings::connect_enabled();
$key_source      = isset( $settings['key_source'] ) ? $settings['key_source'] : 'client';
$has_key         = '' !== (string) ( isset( $settings['claude_api_key'] ) ? $settings['claude_api_key'] : '' );
$modules         = OctoberMI_Modules::all();

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
	<h1><?php esc_html_e( 'October Marketing Platform', 'october-mi' ); ?></h1>
	<p class="octobermi-tagline">
		<?php esc_html_e( 'Switch on the capabilities you need. Each one adds its own menu; anything left off adds nothing. Run standalone with your own key, or connect to the platform for central oversight.', 'october-mi' ); ?>
	</p>

	<?php if ( '' !== $notice ) : ?>
		<div class="notice <?php echo $notice_ok ? 'notice-success' : 'notice-error'; ?> is-dismissible">
			<p><?php echo esc_html( $notice ); ?></p>
		</div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="octobermi_save_settings" />
		<?php wp_nonce_field( 'octobermi_save_settings' ); ?>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Capabilities', 'october-mi' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Turn a capability on to reveal it in the left menu. Turn it off and it disappears completely.', 'october-mi' ); ?></p>
			<?php if ( empty( $modules ) ) : ?>
				<p><em><?php esc_html_e( 'No capabilities are registered.', 'october-mi' ); ?></em></p>
			<?php else : ?>
				<fieldset class="octobermi-modules">
					<?php foreach ( $modules as $id => $module ) : ?>
						<label class="octobermi-module-row">
							<input type="checkbox" name="octobermi_modules[]" value="<?php echo esc_attr( $id ); ?>" <?php checked( OctoberMI_Settings::is_module_enabled( $id ) ); ?> />
							<span class="octobermi-module-label"><strong><?php echo esc_html( $module->label() ); ?></strong>
								<?php if ( $module->description() ) : ?>
									<span class="description"><?php echo esc_html( $module->description() ); ?></span>
								<?php endif; ?>
							</span>
						</label>
					<?php endforeach; ?>
				</fieldset>
			<?php endif; ?>
		</div>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Content engine (Claude)', 'october-mi' ); ?></h2>
			<fieldset>
				<label>
					<input type="radio" name="octobermi_key_source" value="client" <?php checked( $key_source, 'client' ); ?> />
					<?php esc_html_e( 'Use my own Claude API key', 'october-mi' ); ?>
				</label><br />
				<label>
					<input type="radio" name="octobermi_key_source" value="platform" <?php checked( $key_source, 'platform' ); ?> />
					<?php esc_html_e( 'Use an October-managed key (requires an active platform connection)', 'october-mi' ); ?>
				</label>
			</fieldset>

			<p style="margin-top:12px;">
				<label for="octobermi_claude_key"><strong><?php esc_html_e( 'Claude API key', 'october-mi' ); ?></strong></label><br />
				<input type="password" id="octobermi_claude_key" name="octobermi_claude_key" class="regular-text" autocomplete="off"
					placeholder="<?php echo $has_key ? esc_attr( '•••••••• (saved)' ) : esc_attr__( 'sk-ant-…', 'october-mi' ); ?>" />
			</p>
			<?php if ( $has_key ) : ?>
				<p>
					<label><input type="checkbox" name="octobermi_claude_key_clear" value="1" /> <?php esc_html_e( 'Remove the saved key', 'october-mi' ); ?></label>
				</p>
			<?php endif; ?>
			<p class="description">
				<?php esc_html_e( 'Stored encrypted on this site and never shown again. A managed key is never stored here at all — the platform holds it, so October can revoke it at any time.', 'october-mi' ); ?>
			</p>

			<?php $usage = OctoberMI_Usage::this_month(); $cap = (float) ( isset( $settings['monthly_cost_cap'] ) ? $settings['monthly_cost_cap'] : 0 ); ?>
			<p style="margin-top:12px;">
				<label for="octobermi_cost_cap"><strong><?php esc_html_e( 'Monthly cost cap (USD)', 'october-mi' ); ?></strong></label><br />
				<input type="number" id="octobermi_cost_cap" name="octobermi_cost_cap" min="0" step="1" value="<?php echo esc_attr( $cap ? rtrim( rtrim( number_format( $cap, 2, '.', '' ), '0' ), '.' ) : '0' ); ?>" />
				<span class="description"><?php esc_html_e( '0 = unlimited. A safety rail for own-key generation; managed keys are capped platform-side.', 'october-mi' ); ?></span>
			</p>
			<p class="description">
				<?php
				printf(
					/* translators: 1: estimated USD this month, 2: number of model calls. */
					esc_html__( 'This month (estimated): $%1$s over %2$d calls.', 'october-mi' ),
					esc_html( number_format( (float) $usage['cost'], 2 ) ),
					(int) $usage['calls']
				);
				?>
			</p>
		</div>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Platform connection', 'october-mi' ); ?></h2>
			<label>
				<input type="checkbox" name="octobermi_connect_enabled" value="1" <?php checked( $connect_enabled ); ?> />
				<?php esc_html_e( 'Connect this site to the October Marketing Platform', 'october-mi' ); ?>
			</label>
			<p class="description">
				<?php esc_html_e( 'Optional. Connecting unlocks central oversight, an approval queue, managed keys, and heavier research run on the platform. Leave off to run fully standalone.', 'october-mi' ); ?>
			</p>
		</div>

		<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Save settings', 'october-mi' ); ?></button></p>
	</form>

	<?php if ( $connect_enabled ) : ?>

		<?php if ( ! $connected ) : ?>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Pair with the platform', 'october-mi' ); ?></h2>
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
				<h2><?php esc_html_e( 'Connection status', 'october-mi' ); ?></h2>
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

	<?php endif; ?>

	<div class="octobermi-card">
		<h2><?php esc_html_e( 'Automatic updates', 'october-mi' ); ?></h2>
		<p class="description">
			<?php esc_html_e( 'This plugin updates itself automatically from the October platform — no token or manual download needed. New versions appear on the WordPress Updates screen and install on schedule.', 'october-mi' ); ?>
		</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="octobermi_test_update" />
			<?php wp_nonce_field( 'octobermi_test_update' ); ?>
			<button type="submit" class="button"><?php esc_html_e( 'Test update connection', 'october-mi' ); ?></button>
		</form>
	</div>
</div>

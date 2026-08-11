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

$run_mode   = OctoberMI_Settings::run_mode();
$integrated = ( 'integrated' === $run_mode );
$modules    = OctoberMI_Modules::all();
$has_key    = '' !== (string) ( isset( $settings['claude_api_key'] ) ? $settings['claude_api_key'] : '' );
$has_gemini = '' !== (string) ( isset( $settings['gemini_api_key'] ) ? $settings['gemini_api_key'] : '' );
$hero_mode  = isset( $settings['hero_images'] ) ? $settings['hero_images'] : 'library_generate';

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
		<?php esc_html_e( 'Switch on the capabilities you need. Each one adds its own menu; anything left off adds nothing.', 'october-mi' ); ?>
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
			<h2><?php esc_html_e( 'How this site runs', 'october-mi' ); ?></h2>
			<fieldset class="octobermi-modes">
				<label class="octobermi-module-row">
					<input type="radio" name="octobermi_run_mode" value="standalone" <?php checked( ! $integrated ); ?> />
					<span class="octobermi-module-label"><strong><?php esc_html_e( 'Standalone', 'october-mi' ); ?></strong>
						<span class="description"><?php esc_html_e( 'You provide the keys. Everything runs on this site with your own Claude (and, optionally, image) key.', 'october-mi' ); ?></span>
					</span>
				</label>
				<label class="octobermi-module-row">
					<input type="radio" name="octobermi_run_mode" value="integrated" <?php checked( $integrated ); ?> />
					<span class="octobermi-module-label"><strong><?php esc_html_e( 'Integrated with the October Marketing Platform', 'october-mi' ); ?></strong>
						<span class="description"><?php esc_html_e( 'Managed by the platform. Pair once with a token — Claude generation and image generation come from October, so no keys are entered here and October can revoke access at any time.', 'october-mi' ); ?></span>
					</span>
				</label>
			</fieldset>
			<p class="description" style="margin-top:8px;"><?php esc_html_e( 'Change this and Save to see the settings for the chosen mode.', 'october-mi' ); ?></p>
		</div>

		<?php if ( ! $integrated ) : ?>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Content engine (Claude)', 'october-mi' ); ?></h2>
				<p>
					<label for="octobermi_claude_key"><strong><?php esc_html_e( 'Claude API key', 'october-mi' ); ?></strong></label><br />
					<input type="password" id="octobermi_claude_key" name="octobermi_claude_key" class="regular-text" autocomplete="off"
						placeholder="<?php echo $has_key ? esc_attr( '•••••••• (saved)' ) : esc_attr__( 'sk-ant-…', 'october-mi' ); ?>" />
				</p>
				<?php if ( $has_key ) : ?>
					<p><label><input type="checkbox" name="octobermi_claude_key_clear" value="1" /> <?php esc_html_e( 'Remove the saved key', 'october-mi' ); ?></label></p>
				<?php endif; ?>
				<p class="description"><?php esc_html_e( 'Stored encrypted on this site and never shown again.', 'october-mi' ); ?></p>

				<?php $usage = OctoberMI_Usage::this_month(); $cap = (float) ( isset( $settings['monthly_cost_cap'] ) ? $settings['monthly_cost_cap'] : 0 ); ?>
				<p style="margin-top:12px;">
					<label for="octobermi_cost_cap"><strong><?php esc_html_e( 'Monthly cost cap (USD)', 'october-mi' ); ?></strong></label><br />
					<input type="number" id="octobermi_cost_cap" name="octobermi_cost_cap" min="0" step="1" value="<?php echo esc_attr( $cap ? rtrim( rtrim( number_format( $cap, 2, '.', '' ), '0' ), '.' ) : '0' ); ?>" />
					<span class="description"><?php esc_html_e( '0 = unlimited. A safety rail for own-key generation.', 'october-mi' ); ?></span>
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

		<?php endif; ?>

		<div class="octobermi-card">
			<h2><?php esc_html_e( 'Hero images', 'october-mi' ); ?></h2>
			<p>
				<label for="octobermi_hero_images"><strong><?php esc_html_e( 'For each generated post', 'october-mi' ); ?></strong></label><br />
				<select id="octobermi_hero_images" name="octobermi_hero_images">
					<option value="library_generate" <?php selected( $hero_mode, 'library_generate' ); ?>><?php esc_html_e( 'Use the best media-library image, or generate one', 'october-mi' ); ?></option>
					<option value="library" <?php selected( $hero_mode, 'library' ); ?>><?php esc_html_e( 'Use the best media-library image only', 'october-mi' ); ?></option>
					<option value="off" <?php selected( $hero_mode, 'off' ); ?>><?php esc_html_e( 'No hero image', 'october-mi' ); ?></option>
				</select>
			</p>
			<?php if ( $integrated ) : ?>
				<p class="description"><?php esc_html_e( 'The engine scores your existing media (and asks Claude to pick the best fit). If nothing fits, the platform generates a bespoke hero — no image key needed here.', 'october-mi' ); ?></p>
			<?php else : ?>
				<p class="description"><?php esc_html_e( 'The engine scores your existing media (and asks Claude to pick the best fit). If nothing fits and generation is on, it creates one with Gemini and adds it to your library with alt text.', 'october-mi' ); ?></p>
				<p style="margin-top:12px;">
					<label for="octobermi_gemini_key"><strong><?php esc_html_e( 'Gemini image API key', 'october-mi' ); ?></strong> <span class="description"><?php esc_html_e( '(only needed for generation)', 'october-mi' ); ?></span></label><br />
					<input type="password" id="octobermi_gemini_key" name="octobermi_gemini_key" class="regular-text" autocomplete="off"
						placeholder="<?php echo $has_gemini ? esc_attr( '•••••••• (saved)' ) : esc_attr__( 'AIza…', 'october-mi' ); ?>" />
				</p>
				<?php if ( $has_gemini ) : ?>
					<p><label><input type="checkbox" name="octobermi_gemini_key_clear" value="1" /> <?php esc_html_e( 'Remove the saved Gemini key', 'october-mi' ); ?></label></p>
				<?php endif; ?>
			<?php endif; ?>
		</div>

		<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Save settings', 'october-mi' ); ?></button></p>
	</form>

	<?php if ( $integrated ) : ?>

		<?php if ( ! $connected ) : ?>

			<div class="octobermi-card">
				<h2><?php esc_html_e( 'Pair with the platform', 'october-mi' ); ?></h2>
				<p><?php esc_html_e( 'In the October dashboard, open Integrations → Tools, pick this client, and generate a WordPress pairing token. Paste it here and connect — the site makes a single outbound request to pair.', 'october-mi' ); ?></p>
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
				<p class="description"><?php esc_html_e( 'Claude generation and image generation are provided by the platform. No keys are stored on this site.', 'october-mi' ); ?></p>
				<ul class="octobermi-stats">
					<li>
						<span class="octobermi-stat-label"><?php esc_html_e( 'Connected to', 'october-mi' ); ?></span>
						<span class="octobermi-stat-value"><?php echo esc_html( $settings['client_name'] ? $settings['client_name'] : $settings['client_id'] ); ?></span>
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
				</ul>

				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( 'Reset the connection? The site will stop using the platform until you pair again.', 'october-mi' ) ); ?>');">
					<input type="hidden" name="action" value="octobermi_reset" />
					<?php wp_nonce_field( 'octobermi_reset' ); ?>
					<button type="submit" class="button"><?php esc_html_e( 'Reset connection', 'october-mi' ); ?></button>
				</form>
			</div>

		<?php endif; ?>

	<?php endif; ?>

	<div class="octobermi-card">
		<h2><?php esc_html_e( 'Automatic updates', 'october-mi' ); ?></h2>
		<p class="description">
			<?php esc_html_e( 'This plugin updates itself automatically from the October platform. New versions appear on the WordPress Updates screen and install on schedule.', 'october-mi' ); ?>
		</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="octobermi_test_update" />
			<?php wp_nonce_field( 'octobermi_test_update' ); ?>
			<button type="submit" class="button"><?php esc_html_e( 'Test update connection', 'october-mi' ); ?></button>
		</form>
	</div>
</div>

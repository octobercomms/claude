<?php
/**
 * Settings — Stripe keys, mode (test/live) and defaults.
 *
 * Secret keys are never echoed back into the page. Each key field shows a
 * "saved" placeholder when a value exists; leaving it blank on save keeps the
 * stored key, so an admin can re-save other settings without re-entering keys.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Settings {

	const OPTION = 'arpl_settings';

	public static function init() {
		add_action( 'admin_init', [ __CLASS__, 'register_settings' ] );
	}

	public static function register_settings() {
		register_setting( 'arpl_settings_group', self::OPTION, [ __CLASS__, 'sanitize' ] );
	}

	public static function defaults() {
		return [
			'mode'               => 'test',
			'secret_test'        => '',
			'secret_live'        => '',
			'currency'           => 'gbp',
			'deactivate_on_paid' => 1,
		];
	}

	public static function all() {
		return wp_parse_args( get_option( self::OPTION, [] ), self::defaults() );
	}

	public static function get( $key, $default = '' ) {
		$opts = self::all();
		return isset( $opts[ $key ] ) ? $opts[ $key ] : $default;
	}

	/** Secret key for whichever mode is active. */
	public static function active_secret() {
		$opts = self::all();
		return 'live' === $opts['mode'] ? $opts['secret_live'] : $opts['secret_test'];
	}

	public static function mode() {
		return self::get( 'mode', 'test' );
	}

	/** A Stripe client primed with the active-mode secret key. */
	public static function stripe() {
		return new ARPL_Stripe( self::active_secret() );
	}

	public static function sanitize( $input ) {
		$current = self::all();
		$clean   = self::defaults();

		$clean['mode']     = ( isset( $input['mode'] ) && 'live' === $input['mode'] ) ? 'live' : 'test';
		$clean['currency'] = isset( $input['currency'] )
			? strtolower( preg_replace( '/[^a-zA-Z]/', '', $input['currency'] ) )
			: 'gbp';
		if ( 3 !== strlen( $clean['currency'] ) ) {
			$clean['currency'] = 'gbp';
		}
		$clean['deactivate_on_paid'] = empty( $input['deactivate_on_paid'] ) ? 0 : 1;

		// Keys: blank submission preserves the stored key; otherwise sanitise + store.
		foreach ( [ 'secret_test', 'secret_live' ] as $key ) {
			$submitted = isset( $input[ $key ] ) ? trim( $input[ $key ] ) : '';
			if ( '' === $submitted ) {
				$clean[ $key ] = $current[ $key ];
			} else {
				$clean[ $key ] = sanitize_text_field( $submitted );
			}
		}

		return $clean;
	}

	public static function render_page() {
		$opts = self::all();
		?>
		<div class="wrap arpl-wrap">
			<h1>Payment Links — Settings</h1>
			<p>Connect your Stripe account so the plugin can create payment links. Find your keys in the
				<a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">Stripe Dashboard → Developers → API keys</a>.</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'arpl_settings_group' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Mode</th>
						<td>
							<fieldset>
								<label style="margin-right:18px;">
									<input type="radio" name="<?php echo esc_attr( self::OPTION ); ?>[mode]" value="test" <?php checked( $opts['mode'], 'test' ); ?> />
									Test <span class="description">(use sk_test… key — no real charges)</span>
								</label>
								<label>
									<input type="radio" name="<?php echo esc_attr( self::OPTION ); ?>[mode]" value="live" <?php checked( $opts['mode'], 'live' ); ?> />
									Live <span class="description">(use sk_live… key — real payments)</span>
								</label>
							</fieldset>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_secret_test">Test secret key</label></th>
						<td><?php self::render_key_field( 'secret_test', $opts['secret_test'], 'sk_test_…' ); ?></td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_secret_live">Live secret key</label></th>
						<td><?php self::render_key_field( 'secret_live', $opts['secret_live'], 'sk_live_…' ); ?></td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_currency">Default currency</label></th>
						<td>
							<?php
							$currencies = [ 'gbp' => 'GBP £', 'usd' => 'USD $', 'eur' => 'EUR €', 'aud' => 'AUD $', 'cad' => 'CAD $' ];
							?>
							<select id="arpl_currency" name="<?php echo esc_attr( self::OPTION ); ?>[currency]">
								<?php foreach ( $currencies as $code => $label ) : ?>
									<option value="<?php echo esc_attr( $code ); ?>" <?php selected( $opts['currency'], $code ); ?>><?php echo esc_html( $label ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row">After payment</th>
						<td>
							<label>
								<input type="checkbox" name="<?php echo esc_attr( self::OPTION ); ?>[deactivate_on_paid]" value="1" <?php checked( $opts['deactivate_on_paid'], 1 ); ?> />
								Deactivate a link automatically once it's been paid
							</label>
							<p class="description">Stops a balance link being paid twice. Status is checked when you refresh a link or open this dashboard.</p>
						</td>
					</tr>
				</table>
				<?php submit_button( 'Save settings' ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Password field that never reveals the stored key. Shows a "saved" hint when set.
	 */
	private static function render_key_field( $key, $value, $placeholder ) {
		$is_set = '' !== trim( (string) $value );
		?>
		<input type="password"
			id="arpl_<?php echo esc_attr( $key ); ?>"
			name="<?php echo esc_attr( self::OPTION ); ?>[<?php echo esc_attr( $key ); ?>]"
			value=""
			autocomplete="off"
			class="regular-text"
			placeholder="<?php echo $is_set ? 'saved — leave blank to keep' : esc_attr( $placeholder ); ?>" />
		<?php if ( $is_set ) : ?>
			<span class="arpl-key-set" title="A key is stored">✓ stored</span>
		<?php endif; ?>
		<?php
	}
}

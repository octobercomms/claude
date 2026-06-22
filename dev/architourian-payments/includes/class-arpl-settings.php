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
			'brevo_api_key'      => '',
			'from_name'          => 'Architourian',
			'from_email'         => '',
			'email_subject'      => '',
			'email_body'         => '',
			'reminder_subject'   => '',
			'reminder_body'      => '',
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
		foreach ( [ 'secret_test', 'secret_live', 'brevo_api_key' ] as $key ) {
			$submitted = isset( $input[ $key ] ) ? trim( $input[ $key ] ) : '';
			if ( '' === $submitted ) {
				$clean[ $key ] = $current[ $key ];
			} else {
				$clean[ $key ] = sanitize_text_field( $submitted );
			}
		}

		// Email sender + templates.
		$clean['from_name']        = isset( $input['from_name'] ) ? sanitize_text_field( $input['from_name'] ) : 'Architourian';
		$clean['from_email']       = isset( $input['from_email'] ) ? sanitize_email( $input['from_email'] ) : '';
		$clean['email_subject']    = isset( $input['email_subject'] ) ? sanitize_text_field( $input['email_subject'] ) : '';
		$clean['reminder_subject'] = isset( $input['reminder_subject'] ) ? sanitize_text_field( $input['reminder_subject'] ) : '';
		$clean['email_body']       = isset( $input['email_body'] ) ? sanitize_textarea_field( $input['email_body'] ) : '';
		$clean['reminder_body']    = isset( $input['reminder_body'] ) ? sanitize_textarea_field( $input['reminder_body'] ) : '';

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

				<h2 class="title">Emails</h2>
				<p>Used when you email a payment link or a reminder to a customer. Sent through Brevo's
					transactional API when a key is set (otherwise via the site's normal mailer).
					Placeholders: <code>{customer}</code>, <code>{amount}</code>, <code>{note}</code>.</p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="arpl_brevo_api_key">Brevo API key</label></th>
						<td>
							<?php self::render_key_field( 'brevo_api_key', $opts['brevo_api_key'], 'xkeysib-…' ); ?>
							<p class="description">From Brevo → SMTP &amp; API → API Keys. Leave blank to send via the site's default mailer instead.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_from_name">From name</label></th>
						<td><input type="text" id="arpl_from_name" name="<?php echo esc_attr( self::OPTION ); ?>[from_name]"
							value="<?php echo esc_attr( $opts['from_name'] ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_from_email">From email</label></th>
						<td>
							<input type="email" id="arpl_from_email" name="<?php echo esc_attr( self::OPTION ); ?>[from_email]"
								value="<?php echo esc_attr( $opts['from_email'] ); ?>" class="regular-text"
								placeholder="<?php echo esc_attr( get_option( 'admin_email' ) ); ?>" />
							<p class="description">Must be a verified sender in your Brevo account.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_email_subject">Payment email — subject</label></th>
						<td><input type="text" id="arpl_email_subject" name="<?php echo esc_attr( self::OPTION ); ?>[email_subject]"
							value="<?php echo esc_attr( $opts['email_subject'] ); ?>" class="large-text"
							placeholder="<?php echo esc_attr( ARPL_Email::default_subject( 'initial' ) ); ?>" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_email_body">Payment email — message</label></th>
						<td><textarea id="arpl_email_body" name="<?php echo esc_attr( self::OPTION ); ?>[email_body]"
							rows="7" class="large-text" placeholder="<?php echo esc_attr( ARPL_Email::default_body( 'initial' ) ); ?>"><?php echo esc_textarea( $opts['email_body'] ); ?></textarea>
							<p class="description">Leave blank to use the built-in default. The amount box and Pay button are added automatically.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_reminder_subject">Reminder email — subject</label></th>
						<td><input type="text" id="arpl_reminder_subject" name="<?php echo esc_attr( self::OPTION ); ?>[reminder_subject]"
							value="<?php echo esc_attr( $opts['reminder_subject'] ); ?>" class="large-text"
							placeholder="<?php echo esc_attr( ARPL_Email::default_subject( 'reminder' ) ); ?>" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="arpl_reminder_body">Reminder email — message</label></th>
						<td><textarea id="arpl_reminder_body" name="<?php echo esc_attr( self::OPTION ); ?>[reminder_body]"
							rows="7" class="large-text" placeholder="<?php echo esc_attr( ARPL_Email::default_body( 'reminder' ) ); ?>"><?php echo esc_textarea( $opts['reminder_body'] ); ?></textarea>
							<p class="description">Each draft is still fully editable before you hit send.</p>
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

<?php
/**
 * Pricing & Services editor (under the Archie Projects menu).
 *
 * Lets Tiam edit the service menu, add-ons, prices, delivery/validity meta and a
 * couple of canned replies without touching code. Saves to the `yaa_pricing`
 * option that YAA_Pricing reads — so Archie, the panel and the site all follow.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Pricing_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_yaa_save_pricing', array( __CLASS__, 'save' ) );
	}

	public static function menu() {
		add_submenu_page(
			YAA_Projects_Admin::SLUG,
			__( 'Pricing & Services', 'your-architect-archie' ),
			__( 'Pricing & Services', 'your-architect-archie' ),
			'manage_options',
			'yaa-pricing',
			array( __CLASS__, 'render' )
		);
	}

	/** Parse a price field: blank means "priced on request" (null). */
	private static function price( $raw ) {
		$raw = trim( (string) $raw );
		if ( '' === $raw ) {
			return null;
		}
		return (int) preg_replace( '/[^0-9]/', '', $raw );
	}

	public static function save() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_pricing' ) ) {
			wp_die( 'Nope' );
		}
		$in       = wp_unslash( $_POST );
		$defaults = YAA_Pricing::defaults();
		$config   = $defaults; // start from the known shape, overwrite editable fields.

		// Services.
		$svc_in = isset( $in['service'] ) && is_array( $in['service'] ) ? $in['service'] : array();
		foreach ( $defaults['services'] as $key => $svc ) {
			$row = isset( $svc_in[ $key ] ) && is_array( $svc_in[ $key ] ) ? $svc_in[ $key ] : array();
			$config['services'][ $key ]['label']   = isset( $row['label'] ) ? sanitize_text_field( $row['label'] ) : $svc['label'];
			$config['services'][ $key ]['sub']     = isset( $row['sub'] ) ? sanitize_text_field( $row['sub'] ) : ( isset( $svc['sub'] ) ? $svc['sub'] : '' );
			$config['services'][ $key ]['price']   = self::price( isset( $row['price'] ) ? $row['price'] : '' );
			$config['services'][ $key ]['enabled'] = empty( $row['enabled'] ) ? 0 : 1;
			if ( ! empty( $svc['redirect'] ) ) {
				$config['services'][ $key ]['redirect'] = 1;
			}
			if ( ! empty( $svc['submission'] ) ) {
				$config['services'][ $key ]['submission'] = 1;
			}
		}

		// Add-ons.
		$add_in = isset( $in['addon'] ) && is_array( $in['addon'] ) ? $in['addon'] : array();
		foreach ( $defaults['addons'] as $key => $add ) {
			$row = isset( $add_in[ $key ] ) && is_array( $add_in[ $key ] ) ? $add_in[ $key ] : array();
			$config['addons'][ $key ]['label']   = isset( $row['label'] ) ? sanitize_text_field( $row['label'] ) : $add['label'];
			$config['addons'][ $key ]['price']   = (int) self::price( isset( $row['price'] ) ? $row['price'] : '' );
			$config['addons'][ $key ]['enabled'] = empty( $row['enabled'] ) ? 0 : 1;
		}

		// Meta.
		$m = isset( $in['meta'] ) && is_array( $in['meta'] ) ? $in['meta'] : array();
		$config['meta']['delivery']     = isset( $m['delivery'] ) ? sanitize_text_field( $m['delivery'] ) : $defaults['meta']['delivery'];
		$config['meta']['revisions']    = isset( $m['revisions'] ) ? (int) $m['revisions'] : $defaults['meta']['revisions'];
		$config['meta']['validityDays'] = isset( $m['validityDays'] ) ? (int) $m['validityDays'] : $defaults['meta']['validityDays'];
		$config['meta']['ribaEmail']    = isset( $m['ribaEmail'] ) ? sanitize_email( $m['ribaEmail'] ) : $defaults['meta']['ribaEmail'];
		$config['meta']['phone']        = isset( $m['phone'] ) ? sanitize_text_field( $m['phone'] ) : $defaults['meta']['phone'];
		$config['meta']['bookingUrl']   = isset( $m['bookingUrl'] ) ? esc_url_raw( $m['bookingUrl'] ) : '';

		// Canned answers.
		$a = isset( $in['answers'] ) && is_array( $in['answers'] ) ? $in['answers'] : array();
		$config['answers']['structuralUnsure'] = isset( $a['structuralUnsure'] ) ? sanitize_textarea_field( $a['structuralUnsure'] ) : $defaults['answers']['structuralUnsure'];
		$config['answers']['surveyHelp']        = isset( $a['surveyHelp'] ) ? sanitize_textarea_field( $a['surveyHelp'] ) : $defaults['answers']['surveyHelp'];

		YAA_Pricing::save( $config );
		wp_safe_redirect( add_query_arg( 'updated', '1', wp_get_referer() ) );
		exit;
	}

	public static function render() {
		$t = YAA_Pricing::table();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Pricing & Services', 'your-architect-archie' ); ?></h1>
			<p class="description"><?php esc_html_e( 'Edit the services, prices and add-ons Archie offers. Leave a service price blank to make it “priced on request”. Untick a service to hide it. Changes apply immediately to Archie and the price panel.', 'your-architect-archie' ); ?></p>
			<?php if ( isset( $_GET['updated'] ) ) : ?><div class="notice notice-success"><p><?php esc_html_e( 'Saved.', 'your-architect-archie' ); ?></p></div><?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="yaa_save_pricing">
				<?php wp_nonce_field( 'yaa_pricing' ); ?>

				<h2><?php esc_html_e( 'Services', 'your-architect-archie' ); ?></h2>
				<table class="widefat striped" style="max-width:1000px">
					<thead><tr>
						<th style="width:60px"><?php esc_html_e( 'On', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Service', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Short description', 'your-architect-archie' ); ?></th>
						<th style="width:130px"><?php esc_html_e( 'Price (£)', 'your-architect-archie' ); ?></th>
					</tr></thead>
					<tbody>
					<?php foreach ( $t['services'] as $key => $svc ) : ?>
						<tr>
							<td style="text-align:center"><input type="checkbox" name="service[<?php echo esc_attr( $key ); ?>][enabled]" value="1" <?php checked( ! empty( $svc['enabled'] ) ); ?>></td>
							<td><input type="text" name="service[<?php echo esc_attr( $key ); ?>][label]" value="<?php echo esc_attr( $svc['label'] ); ?>" class="regular-text"></td>
							<td><input type="text" name="service[<?php echo esc_attr( $key ); ?>][sub]" value="<?php echo esc_attr( isset( $svc['sub'] ) ? $svc['sub'] : '' ); ?>" class="regular-text"></td>
							<td><input type="text" inputmode="numeric" name="service[<?php echo esc_attr( $key ); ?>][price]" value="<?php echo esc_attr( ( null === $svc['price'] || '' === $svc['price'] ) ? '' : (int) $svc['price'] ); ?>" placeholder="<?php esc_attr_e( 'on request', 'your-architect-archie' ); ?>" style="width:110px"></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>

				<h2 style="margin-top:28px"><?php esc_html_e( 'Optional add-ons', 'your-architect-archie' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Archie asks about these and adds them to the price — the customer never has to “remove” anything.', 'your-architect-archie' ); ?></p>
				<table class="widefat striped" style="max-width:1000px">
					<thead><tr>
						<th style="width:60px"><?php esc_html_e( 'On', 'your-architect-archie' ); ?></th>
						<th><?php esc_html_e( 'Add-on', 'your-architect-archie' ); ?></th>
						<th style="width:130px"><?php esc_html_e( 'Price (£)', 'your-architect-archie' ); ?></th>
					</tr></thead>
					<tbody>
					<?php foreach ( $t['addons'] as $key => $add ) : ?>
						<tr>
							<td style="text-align:center"><input type="checkbox" name="addon[<?php echo esc_attr( $key ); ?>][enabled]" value="1" <?php checked( ! empty( $add['enabled'] ) ); ?>></td>
							<td><input type="text" name="addon[<?php echo esc_attr( $key ); ?>][label]" value="<?php echo esc_attr( $add['label'] ); ?>" class="regular-text"></td>
							<td><input type="text" inputmode="numeric" name="addon[<?php echo esc_attr( $key ); ?>][price]" value="<?php echo esc_attr( (int) $add['price'] ); ?>" style="width:110px"></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>

				<h2 style="margin-top:28px"><?php esc_html_e( 'Details', 'your-architect-archie' ); ?></h2>
				<table class="form-table" role="presentation" style="max-width:820px">
					<tr><th><?php esc_html_e( 'Delivery', 'your-architect-archie' ); ?></th><td><input type="text" name="meta[delivery]" value="<?php echo esc_attr( $t['meta']['delivery'] ); ?>" class="regular-text"></td></tr>
					<tr><th><?php esc_html_e( 'Revisions included', 'your-architect-archie' ); ?></th><td><input type="number" name="meta[revisions]" value="<?php echo esc_attr( (int) $t['meta']['revisions'] ); ?>" style="width:90px"></td></tr>
					<tr><th><?php esc_html_e( 'Quote valid (days)', 'your-architect-archie' ); ?></th><td><input type="number" name="meta[validityDays]" value="<?php echo esc_attr( (int) $t['meta']['validityDays'] ); ?>" style="width:90px"></td></tr>
					<tr><th><?php esc_html_e( 'RIBA / larger-project email', 'your-architect-archie' ); ?></th><td><input type="email" name="meta[ribaEmail]" value="<?php echo esc_attr( $t['meta']['ribaEmail'] ); ?>" class="regular-text"></td></tr>
					<tr><th><?php esc_html_e( 'Phone number', 'your-architect-archie' ); ?></th><td><input type="text" name="meta[phone]" value="<?php echo esc_attr( $t['meta']['phone'] ); ?>" class="regular-text"></td></tr>
					<tr><th><?php esc_html_e( '15-min call booking link', 'your-architect-archie' ); ?></th><td><input type="url" name="meta[bookingUrl]" value="<?php echo esc_attr( $t['meta']['bookingUrl'] ); ?>" class="regular-text" placeholder="https://…"></td></tr>
				</table>

				<h2 style="margin-top:28px"><?php esc_html_e( 'Canned replies', 'your-architect-archie' ); ?></h2>
				<table class="form-table" role="presentation" style="max-width:820px">
					<tr><th><?php esc_html_e( 'If unsure about a structural engineer', 'your-architect-archie' ); ?></th><td><textarea name="answers[structuralUnsure]" rows="2" class="large-text"><?php echo esc_textarea( $t['answers']['structuralUnsure'] ); ?></textarea></td></tr>
					<tr><th><?php esc_html_e( 'No existing plans (survey help)', 'your-architect-archie' ); ?></th><td><textarea name="answers[surveyHelp]" rows="3" class="large-text"><?php echo esc_textarea( $t['answers']['surveyHelp'] ); ?></textarea></td></tr>
				</table>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}

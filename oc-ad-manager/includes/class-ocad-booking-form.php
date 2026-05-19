<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Booking_Form {

	public function __construct() {
		add_shortcode( 'ocad_book', array( $this, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	public function enqueue_assets() {
		global $post;
		if ( ! is_a( $post, 'WP_Post' ) || ! has_shortcode( $post->post_content, 'ocad_book' ) ) {
			return;
		}
		wp_enqueue_script( 'ocad-booking', OCAD_URL . 'assets/js/booking.js', array(), OCAD_VERSION, true );
		wp_localize_script( 'ocad-booking', 'ocadBooking', array(
			'restUrl'  => rest_url( 'ocad/v1/book' ),
			'promoUrl' => rest_url( 'ocad/v1/promo' ),
			'nonce'    => wp_create_nonce( 'wp_rest' ),
			'currency' => strtoupper( get_option( 'ocad_stripe_currency', 'USD' ) ),
			'prices'   => array(
				'mpu'         => (int) get_option( 'ocad_price_mpu', 150 ),
				'leaderboard' => (int) get_option( 'ocad_price_leaderboard', 200 ),
				'skyscraper'  => (int) get_option( 'ocad_price_skyscraper', 100 ),
			),
		) );
		wp_enqueue_style( 'ocad-booking', OCAD_URL . 'assets/css/booking.css', array(), OCAD_VERSION );
	}

	public function render( $atts ) {
		if ( ! get_option( 'ocad_stripe_pub_key' ) || ! get_option( 'ocad_stripe_secret_key' ) ) {
			if ( current_user_can( 'manage_options' ) ) {
				return '<p style="color:#b91c1c;border:1px solid #fca5a5;padding:12px;border-radius:6px;background:#fef2f2;">'
					. '<strong>Ad Manager:</strong> Stripe keys not configured. '
					. '<a href="' . esc_url( admin_url( 'admin.php?page=ocad-settings' ) ) . '">Go to Settings</a>.</p>';
			}
			return '';
		}

		if ( isset( $_GET['ocad_booking'] ) ) {
			$state = sanitize_key( $_GET['ocad_booking'] );
			if ( $state === 'success' ) {
				return '<div class="ocad-booking-notice ocad-booking-notice--success">'
					. '<strong>Booking received!</strong> Thank you — your payment has been processed. '
					. 'We\'ll review your ad and be in touch to confirm when it goes live.'
					. '</div>';
			}
			if ( $state === 'cancelled' ) {
				return '<div class="ocad-booking-notice ocad-booking-notice--info">'
					. 'Payment was cancelled. Your booking has not been placed — you can try again below.'
					. '</div>'
					. $this->form_html();
			}
		}

		return $this->form_html();
	}

	private function form_html() {
		$min_date = date( 'Y-m-d', strtotime( '+1 day' ) );
		ob_start();
		?>
		<div class="ocad-booking" id="ocad-booking-wrap">
			<form class="ocad-booking-form" id="ocad-booking-form" novalidate>

				<fieldset class="ocad-booking-section">
					<legend class="ocad-booking-section-title">Your Details</legend>
					<div class="ocad-booking-row ocad-booking-row--2">
						<div class="ocad-booking-field">
							<label for="ocad-name">Full Name <span class="ocad-req" aria-hidden="true">*</span></label>
							<input type="text" id="ocad-name" name="name" required autocomplete="name" placeholder="Jane Smith">
						</div>
						<div class="ocad-booking-field">
							<label for="ocad-email">Email Address <span class="ocad-req" aria-hidden="true">*</span></label>
							<input type="email" id="ocad-email" name="email" required autocomplete="email" placeholder="jane@example.com">
						</div>
					</div>
					<div class="ocad-booking-row ocad-booking-row--2">
						<div class="ocad-booking-field">
							<label for="ocad-company">Company / Organisation</label>
							<input type="text" id="ocad-company" name="company" autocomplete="organization">
						</div>
						<div class="ocad-booking-field">
							<label for="ocad-phone">Phone</label>
							<input type="tel" id="ocad-phone" name="phone" autocomplete="tel">
						</div>
					</div>
				</fieldset>

				<fieldset class="ocad-booking-section">
					<legend class="ocad-booking-section-title">Ad Details</legend>
					<div class="ocad-booking-row ocad-booking-row--2">
						<div class="ocad-booking-field">
							<label for="ocad-format">Ad Format <span class="ocad-req" aria-hidden="true">*</span></label>
							<select id="ocad-format" name="format" required>
								<option value="">— Select a format —</option>
								<?php foreach ( OCAD_FORMATS as $key => $fmt ) : ?>
									<option value="<?php echo esc_attr( $key ); ?>">
										<?php echo esc_html( $fmt['label'] . ' (' . $fmt['width'] . '×' . $fmt['height'] . 'px)' ); ?>
									</option>
								<?php endforeach; ?>
							</select>
						</div>
						<div class="ocad-booking-field">
							<label for="ocad-weeks">Duration <span class="ocad-req" aria-hidden="true">*</span></label>
							<select id="ocad-weeks" name="weeks" required>
								<?php for ( $i = 1; $i <= 52; $i++ ) : ?>
									<option value="<?php echo $i; ?>"><?php echo $i === 1 ? '1 week' : "$i weeks"; ?></option>
								<?php endfor; ?>
							</select>
						</div>
					</div>
					<div class="ocad-booking-row ocad-booking-row--2">
						<div class="ocad-booking-field">
							<label for="ocad-start-date">Start Date <span class="ocad-req" aria-hidden="true">*</span></label>
							<input type="date" id="ocad-start-date" name="start_date" required min="<?php echo esc_attr( $min_date ); ?>">
						</div>
						<div class="ocad-booking-field">
							<label for="ocad-destination">Destination URL <span class="ocad-req" aria-hidden="true">*</span></label>
							<input type="url" id="ocad-destination" name="destination_url" required placeholder="https://" autocomplete="url">
							<small>Where should ad clicks take visitors?</small>
						</div>
					</div>
					<div class="ocad-booking-field">
						<label for="ocad-image">Ad Image <span class="ocad-req" aria-hidden="true">*</span></label>
						<input type="file" id="ocad-image" name="image" required accept="image/jpeg,image/png,image/gif,image/webp">
						<small>JPG, PNG, GIF or WebP · Max 5 MB · Supply artwork at the exact pixel dimensions for your chosen format.</small>
					</div>
				</fieldset>

				<fieldset class="ocad-booking-section ocad-booking-summary" id="ocad-summary" style="display:none;">
					<legend class="ocad-booking-section-title">Order Summary</legend>
					<table class="ocad-booking-summary-table">
						<tr><td>Format</td><td id="ocad-sum-format">—</td></tr>
						<tr><td>Duration</td><td id="ocad-sum-duration">—</td></tr>
						<tr id="ocad-sum-promo-row" style="display:none;">
							<td>Discount</td>
							<td id="ocad-sum-discount" style="color:#16a34a;">—</td>
						</tr>
						<tr class="ocad-booking-summary-total">
							<td><strong>Total</strong></td>
							<td id="ocad-sum-total">—</td>
						</tr>
					</table>

					<div class="ocad-booking-promo">
						<label for="ocad-promo">Have a promo code?</label>
						<div class="ocad-booking-promo-row">
							<input type="text" id="ocad-promo" name="promo_code" placeholder="Enter code" autocomplete="off">
							<button type="button" id="ocad-apply-promo" class="ocad-booking-btn ocad-booking-btn--outline">Apply</button>
						</div>
						<small id="ocad-promo-msg"></small>
					</div>
				</fieldset>

				<div class="ocad-booking-actions">
					<button type="submit" class="ocad-booking-btn ocad-booking-btn--primary" id="ocad-submit-btn" disabled>
						Continue to Payment
					</button>
					<p class="ocad-booking-secure">Secure checkout via Stripe</p>
				</div>

				<div id="ocad-booking-error" class="ocad-booking-notice ocad-booking-notice--error" style="display:none;"></div>
			</form>
		</div>
		<?php
		return ob_get_clean();
	}
}

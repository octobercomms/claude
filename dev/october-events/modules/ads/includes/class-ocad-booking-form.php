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

		wp_enqueue_script( 'stripe-js', 'https://js.stripe.com/v3/', array(), null, true );
		wp_enqueue_script( 'ocad-booking', OCAD_URL . 'assets/js/booking.js', array( 'stripe-js' ), OCAD_VERSION, true );
		wp_localize_script( 'ocad-booking', 'ocadBooking', array(
			'restUrl'    => rest_url( 'ocad/v1/book-intent' ),
			'promoUrl'   => rest_url( 'ocad/v1/promo' ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'stripeKey'  => get_option( 'ocad_stripe_pub_key', '' ),
			'currency'   => strtoupper( get_option( 'ocad_stripe_currency', 'USD' ) ),
			'packages'   => self::get_packages_for_js(),
		) );
		wp_enqueue_style( 'ocad-booking', OCAD_URL . 'assets/css/booking.css', array(), OCAD_VERSION );
	}

	private static function get_packages_for_js() {
		$packages = get_option( 'ocad_booking_packages', array() );
		$out = array();
		foreach ( $packages as $pkg ) {
			if ( ! empty( $pkg['name'] ) && ! empty( $pkg['price'] ) ) {
				$out[] = array(
					'name'     => $pkg['name'],
					'type'     => $pkg['type'] ?? 'impressions',
					'quantity' => (int) ( $pkg['quantity'] ?? 0 ),
					'price'    => (int) $pkg['price'],
				);
			}
		}
		return $out;
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

		$packages = get_option( 'ocad_booking_packages', array() );
		if ( empty( $packages ) ) {
			if ( current_user_can( 'manage_options' ) ) {
				return '<p style="color:#92400e;border:1px solid #fcd34d;padding:12px;border-radius:6px;background:#fffbeb;">'
					. '<strong>Ad Manager:</strong> No booking packages configured. '
					. '<a href="' . esc_url( admin_url( 'admin.php?page=ocad-settings' ) ) . '">Add packages in Settings</a>.</p>';
			}
			return '';
		}

		return $this->form_html( $packages );
	}

	private function form_html( $packages ) {
		$min_date = date( 'Y-m-d', strtotime( '+1 day' ) );
		ob_start();
		?>
		<div class="ocad-booking" id="ocad-booking-wrap">

			<div id="ocad-booking-success" class="ocad-booking-notice ocad-booking-notice--success" style="display:none;">
				<strong>Payment received — thank you!</strong> Your booking is under review. We'll be in touch to confirm when your campaign goes live.
			</div>

			<form class="ocad-booking-form" id="ocad-booking-form" novalidate>

				<section class="ocad-section">
					<h3 class="ocad-section-title">Choose Your Package</h3>
					<div class="ocad-package-list">
						<?php foreach ( $packages as $pkg ) :
							if ( empty( $pkg['name'] ) || empty( $pkg['price'] ) ) continue;
							$qty_label = ! empty( $pkg['quantity'] ) ? number_format( $pkg['quantity'] ) . ' ' . ( $pkg['type'] === 'clicks' ? 'clicks' : 'impressions' ) : '';
						?>
						<label class="ocad-package-row">
							<input type="radio" name="package_name" value="<?php echo esc_attr( $pkg['name'] ); ?>" data-price="<?php echo (int) $pkg['price']; ?>" required>
							<span class="ocad-package-info">
								<span class="ocad-package-name"><?php echo esc_html( $pkg['name'] ); ?></span>
								<?php if ( $qty_label ) : ?>
								<span class="ocad-package-desc"><?php echo esc_html( $qty_label ); ?></span>
								<?php endif; ?>
							</span>
							<span class="ocad-package-price"><?php echo esc_html( number_format( (int) $pkg['price'] ) ); ?></span>
						</label>
						<?php endforeach; ?>
					</div>
				</section>

				<section class="ocad-section">
					<h3 class="ocad-section-title">Campaign Details</h3>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-campaign-name">Campaign Name <span class="ocad-req">*</span></label>
						<div class="ocad-field-input">
							<input type="text" class="ocad-input" id="ocad-campaign-name" name="campaign_name" required placeholder="e.g. Summer Sale 2026">
						</div>
					</div>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-client">Client / Advertiser <span class="ocad-optional">(optional)</span></label>
						<div class="ocad-field-input">
							<input type="text" class="ocad-input" id="ocad-client" name="company" autocomplete="organization" placeholder="Company or brand name">
						</div>
					</div>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-email">Email Address <span class="ocad-req">*</span></label>
						<div class="ocad-field-input">
							<input type="email" class="ocad-input" id="ocad-email" name="email" required autocomplete="email" placeholder="jane@example.com">
							<span class="ocad-field-hint">Confirmation and campaign reports are sent here</span>
						</div>
					</div>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-destination">Destination URL <span class="ocad-req">*</span></label>
						<div class="ocad-field-input">
							<input type="url" class="ocad-input" id="ocad-destination" name="destination_url" required placeholder="https://" autocomplete="url">
							<span class="ocad-field-hint">Where ad clicks take visitors</span>
						</div>
					</div>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-start-date">Start Date <span class="ocad-req">*</span></label>
						<div class="ocad-field-input">
							<input type="date" class="ocad-input" id="ocad-start-date" name="start_date" required min="<?php echo esc_attr( $min_date ); ?>">
						</div>
					</div>

					<div class="ocad-field-group">
						<label class="ocad-label" for="ocad-end-date">End Date <span class="ocad-req">*</span></label>
						<div class="ocad-field-input">
							<input type="date" class="ocad-input" id="ocad-end-date" name="end_date" required min="<?php echo esc_attr( $min_date ); ?>">
							<span class="ocad-field-hint">Campaign deactivates after this date</span>
						</div>
					</div>
				</section>

				<section class="ocad-section">
					<h3 class="ocad-section-title">Ad Creatives</h3>
					<p class="ocad-section-note">Upload artwork for each format you require. At least one is required. Leave formats blank if not needed.</p>

					<?php foreach ( OCAD_FORMATS as $fmt_key => $fmt_info ) : ?>
					<div class="ocad-creative-row">
						<div class="ocad-creative-label">
							<strong><?php echo esc_html( $fmt_info['label'] ); ?></strong>
							<span class="ocad-creative-spec"><?php echo esc_html( $fmt_info['width'] . ' × ' . $fmt_info['height'] . ' px' ); ?></span>
						</div>
						<div class="ocad-field-input">
							<input type="file" name="image_<?php echo esc_attr( $fmt_key ); ?>" accept="image/jpeg,image/png,image/gif,image/webp">
							<span class="ocad-field-hint">JPG, PNG, GIF or WebP · Max 5 MB</span>
						</div>
					</div>
					<?php endforeach; ?>
				</section>

				<section id="ocad-summary" class="ocad-section ocad-summary" style="display:none;">
					<h3 class="ocad-section-title">Order Summary</h3>

					<div class="ocad-summary-row">
						<span>Package</span>
						<span id="ocad-sum-package" class="ocad-summary-price">—</span>
					</div>
					<div class="ocad-summary-row" id="ocad-sum-promo-row" style="display:none;">
						<span>Discount</span>
						<span id="ocad-sum-discount" class="ocad-discount-value">—</span>
					</div>
					<div class="ocad-summary-row ocad-summary-total">
						<span>Total</span>
						<span id="ocad-sum-total">—</span>
					</div>

					<div class="ocad-promo">
						<div class="ocad-promo-row">
							<input type="text" class="ocad-input" id="ocad-promo" name="promo_code" placeholder="Promo code" autocomplete="off">
							<button type="button" id="ocad-apply-promo" class="ocad-btn ocad-btn--secondary">Apply</button>
						</div>
						<small id="ocad-promo-msg" class="ocad-promo-message"></small>
					</div>
				</section>

				<section class="ocad-section">
					<h3 class="ocad-section-title">Payment</h3>
					<div class="ocad-field-input">
						<label class="ocad-label">Card Details <span class="ocad-req">*</span></label>
						<div id="ocad-card-element" class="ocad-card-element"></div>
						<div id="ocad-card-errors" class="ocad-card-errors" role="alert"></div>
					</div>
				</section>

				<div class="ocad-booking-actions">
					<button type="submit" class="ocad-btn ocad-btn--primary ocad-btn--full" id="ocad-submit-btn" disabled>
						Pay Now
					</button>
					<p class="ocad-booking-secure">Secured by Stripe</p>
				</div>

				<div id="ocad-booking-error" class="ocad-booking-notice ocad-booking-notice--error" style="display:none;"></div>
			</form>
		</div>
		<?php
		return ob_get_clean();
	}
}

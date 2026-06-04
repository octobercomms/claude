<?php
/**
 * Public maintenance-plan experience + subscription webhook handling.
 *
 * Registers the [hgd_maintenance_plans] shortcode (on-brand plan cards + a short
 * sign-up form) and one REST route:
 *   - POST /subscription/checkout   create a pending subscription + Stripe
 *                                    Checkout Session (subscription mode)
 *
 * The customer is redirected to Stripe's hosted Checkout, which collects the
 * card, handles SCA, creates the subscription and takes the first payment.
 * Stripe Billing then owns the recurring charge, automatic retries and dunning
 * emails. We listen on the shared Stripe webhook (HGD_Booking_Page) via the
 * `hgd_stripe_webhook_event` action to keep our local record in step and to
 * mirror each paid invoice into a WooCommerce order for receipts.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Subscription_Page {

	const NS = 'hgd/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_shortcode( 'hgd_maintenance_plans', array( __CLASS__, 'shortcode' ) );
		add_shortcode( 'hgd_manage_plan', array( __CLASS__, 'manage_shortcode' ) );
		add_action( 'hgd_stripe_webhook_event', array( __CLASS__, 'handle_webhook_event' ), 10, 2 );

		// Self-service entry: ?hgd_manage=<token> → Stripe Customer Portal.
		add_filter( 'query_vars', array( __CLASS__, 'register_query_var' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_manage' ) );
	}

	public static function register_query_var( $vars ) {
		$vars[] = 'hgd_manage';
		return $vars;
	}

	/** Are subscriptions sellable (Stripe secret key present)? */
	public static function is_configured() {
		return HGD_Stripe::is_configured();
	}

	// -------------------------------------------------------------------------
	// REST
	// -------------------------------------------------------------------------

	public static function register_routes() {
		register_rest_route( self::NS, '/subscription/checkout', array(
			'methods'             => 'POST',
			'permission_callback' => array( __CLASS__, 'checkout_permission' ),
			'callback'            => array( __CLASS__, 'rest_checkout' ),
		) );

		register_rest_route( self::NS, '/subscription/manage-link', array(
			'methods'             => 'POST',
			'permission_callback' => array( __CLASS__, 'checkout_permission' ),
			'callback'            => array( __CLASS__, 'rest_manage_link' ),
		) );
	}

	/** Nonce-protect the public POST routes. */
	public static function checkout_permission( $request ) {
		return (bool) wp_verify_nonce( $request->get_header( 'X-WP-Nonce' ), 'wp_rest' );
	}

	public static function rest_checkout( $request ) {
		if ( ! self::is_configured() ) {
			return new WP_Error( 'hgd_not_configured', __( 'Plans are not yet available for sign-up.', 'hillcroft-garden-designer' ), array( 'status' => 503 ) );
		}
		// Throttle — each call creates a pending row + a Stripe Checkout Session.
		if ( ! HGD_Rate_Limit::check( 'subscription_checkout', 10, 10 * MINUTE_IN_SECONDS ) ) {
			return new WP_Error( 'hgd_rate_limited', __( 'Too many attempts. Please wait a moment and try again.', 'hillcroft-garden-designer' ), array( 'status' => 429 ) );
		}

		$plan_key = sanitize_text_field( (string) $request->get_param( 'plan_key' ) );
		$plan     = HGD_Subscription::plan( $plan_key );
		if ( ! $plan ) {
			return new WP_Error( 'hgd_bad_plan', __( 'Please choose a plan.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}

		$name     = sanitize_text_field( (string) $request->get_param( 'name' ) );
		$email    = sanitize_email( (string) $request->get_param( 'email' ) );
		$phone    = sanitize_text_field( (string) $request->get_param( 'phone' ) );
		$postcode = sanitize_text_field( (string) $request->get_param( 'postcode' ) );

		if ( '' === $name || ! is_email( $email ) ) {
			return new WP_Error( 'hgd_bad_input', __( 'Please provide your name and a valid email address.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}

		$interval = isset( $plan['interval'] ) ? (string) $plan['interval'] : 'month';
		$amount   = round( (float) $plan['price'], 2 );

		// A recurring Price for this plan (created + cached on first use).
		$price_id = HGD_Stripe::ensure_price( $plan_key, (string) $plan['label'], (int) round( $amount * 100 ), $interval );
		if ( is_wp_error( $price_id ) ) {
			return new WP_Error( 'hgd_stripe_failed', __( 'Sorry — we couldn\'t start your sign-up just now. Please try again shortly.', 'hillcroft-garden-designer' ), array( 'status' => 502 ) );
		}

		// Pending local record — promoted to active by the webhook on payment.
		$sub_id = HGD_Subscription::create( array(
			'plan_key'         => $plan_key,
			'plan_label'       => (string) $plan['label'],
			'name'             => $name,
			'email'            => $email,
			'phone'            => $phone,
			'postcode'         => $postcode,
			'amount_gbp'       => $amount,
			'billing_interval' => $interval,
			'status'           => 'incomplete',
		) );
		if ( ! $sub_id ) {
			return new WP_Error( 'hgd_save_failed', __( 'Could not start your sign-up. Please try again.', 'hillcroft-garden-designer' ), array( 'status' => 500 ) );
		}

		// Build success/cancel URLs from the page the form lives on. Stripe
		// substitutes the literal {CHECKOUT_SESSION_ID} placeholder, so it must
		// not be url-encoded.
		$return  = esc_url_raw( (string) $request->get_param( 'return_url' ) );
		if ( '' === $return ) {
			$return = home_url( '/' );
		}
		$glue    = ( false !== strpos( $return, '?' ) ) ? '&' : '?';
		$success = $return . $glue . 'hgd_sub=success&session_id={CHECKOUT_SESSION_ID}';
		$cancel  = $return . $glue . 'hgd_sub=cancel';

		$session = HGD_Stripe::create_subscription_checkout( array(
			'price_id'    => $price_id,
			'email'       => $email,
			'success_url' => $success,
			'cancel_url'  => $cancel,
			'metadata'    => array(
				'hgd_kind'        => 'subscription',
				'subscription_id' => (string) $sub_id,
				'plan_key'        => $plan_key,
			),
		) );

		if ( is_wp_error( $session ) ) {
			HGD_Subscription::update( $sub_id, array( 'status' => 'canceled' ) );
			return new WP_Error( 'hgd_stripe_failed', __( 'Sorry — we couldn\'t start your sign-up just now. Please try again shortly.', 'hillcroft-garden-designer' ), array( 'status' => 502 ) );
		}

		HGD_Subscription::update( $sub_id, array(
			'stripe_checkout_session' => sanitize_text_field( isset( $session['id'] ) ? $session['id'] : '' ),
		) );

		return new WP_REST_Response( array(
			'subscription_id' => $sub_id,
			'redirect_url'    => isset( $session['url'] ) ? $session['url'] : '',
		), 200 );
	}

	// -------------------------------------------------------------------------
	// Self-service — Stripe Customer Portal (manage card / invoices / cancel)
	// -------------------------------------------------------------------------

	private static function current_manage_token() {
		$token = get_query_var( 'hgd_manage' );
		if ( '' === $token && isset( $_GET['hgd_manage'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$token = wp_unslash( $_GET['hgd_manage'] ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		return preg_replace( '/[^A-Za-z0-9]/', '', (string) $token );
	}

	/**
	 * On ?hgd_manage=<token>, open a Stripe Customer Portal session for that
	 * subscriber and redirect them to it. The token is the only credential, so
	 * everything is re-validated here and the customer id comes from our record.
	 */
	public static function maybe_manage() {
		$token = self::current_manage_token();
		if ( '' === $token ) {
			return;
		}

		nocache_headers();

		$sub = HGD_Subscription::find_by_manage_token( $token );
		if ( ! $sub || empty( $sub['stripe_customer_id'] ) ) {
			status_header( 404 );
			self::render_manage_message(
				__( 'Link not available', 'hillcroft-garden-designer' ),
				__( 'This management link is no longer valid, or your plan is not yet active. If you\'ve just signed up, please try again in a few minutes.', 'hillcroft-garden-designer' )
			);
			exit;
		}

		$session = HGD_Stripe::create_billing_portal_session(
			(string) $sub['stripe_customer_id'],
			home_url( '/' )
		);

		if ( is_wp_error( $session ) || empty( $session['url'] ) ) {
			status_header( 502 );
			self::render_manage_message(
				__( 'Couldn\'t open your account', 'hillcroft-garden-designer' ),
				__( 'Sorry — we couldn\'t open your billing account just now. Please try again shortly, or get in touch and we\'ll help.', 'hillcroft-garden-designer' )
			);
			exit;
		}

		wp_redirect( esc_url_raw( $session['url'] ) );
		exit;
	}

	/** A minimal branded page for manage-link errors. */
	private static function render_manage_message( $title, $body ) {
		header( 'Content-Type: text/html; charset=utf-8' );
		echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
		echo '<title>' . esc_html( $title ) . '</title>';
		echo '<div style="max-width:520px;margin:12vh auto;padding:32px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1B1C18;text-align:center;">';
		echo '<h1 style="font-size:24px;color:#494A20;">' . esc_html( $title ) . '</h1>';
		echo '<p style="line-height:1.5;opacity:.85;">' . esc_html( $body ) . '</p>';
		echo '<p><a href="' . esc_url( home_url( '/' ) ) . '" style="color:#494A20;">' . esc_html__( 'Return to the website', 'hillcroft-garden-designer' ) . '</a></p>';
		echo '</div>';
	}

	/**
	 * Email a magic self-service link to a returning subscriber. To avoid email
	 * enumeration, the response is always neutral regardless of whether a
	 * matching subscription exists.
	 */
	public static function rest_manage_link( $request ) {
		$email = sanitize_email( (string) $request->get_param( 'email' ) );
		if ( is_email( $email ) ) {
			// Throttle to stop this endpoint being used to email-bomb a known
			// subscriber or burn the site's mail quota. The per-email cap is the
			// real defence (it holds across rotating source IPs); the per-IP cap
			// blunts blind spraying. Either way the response stays neutral so we
			// neither confirm the address nor reveal the throttle.
			$ip_ok    = HGD_Rate_Limit::check( 'manage_link_ip', 12, HOUR_IN_SECONDS );
			$email_ok = HGD_Rate_Limit::check( 'manage_link_email', 3, HOUR_IN_SECONDS, $email );
			if ( $ip_ok && $email_ok ) {
				$sub = HGD_Subscription::latest_manageable_for_email( $email );
				if ( $sub ) {
					self::send_manage_link( $sub );
				}
			}
		}

		return new WP_REST_Response( array(
			'message' => __( 'If that email has an active maintenance plan, we\'ve sent a secure link to manage it.', 'hillcroft-garden-designer' ),
		), 200 );
	}

	/** Send the self-service link email to the subscriber. */
	public static function send_manage_link( array $sub ) {
		$url     = HGD_Subscription::manage_url( $sub );
		$name    = (string) $sub['name'];
		$site    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$subject = sprintf(
			/* translators: %s: site name */
			__( 'Manage your %s maintenance plan', 'hillcroft-garden-designer' ),
			$site
		);
		$body  = ( '' !== trim( $name ) ? sprintf( __( 'Hi %s,', 'hillcroft-garden-designer' ), $name ) : __( 'Hello,', 'hillcroft-garden-designer' ) ) . "\n\n";
		$body .= __( 'Use the secure link below to manage your garden maintenance plan — update your card, view invoices or cancel:', 'hillcroft-garden-designer' ) . "\n\n";
		$body .= $url . "\n\n";
		$body .= __( 'For your security this link is unique to you. If you didn\'t request it, you can safely ignore this email.', 'hillcroft-garden-designer' ) . "\n";

		wp_mail( (string) $sub['email'], $subject, $body, array( 'Content-Type: text/plain; charset=UTF-8' ) );
	}

	// -------------------------------------------------------------------------
	// Webhook — keep the local record in step with Stripe Billing
	// -------------------------------------------------------------------------

	public static function handle_webhook_event( $type, $event ) {
		$object = isset( $event['data']['object'] ) ? $event['data']['object'] : array();
		if ( ! is_array( $object ) ) {
			return;
		}

		switch ( $type ) {
			case 'checkout.session.completed':
				self::on_checkout_completed( $object );
				break;
			case 'invoice.paid':
			case 'invoice.payment_succeeded':
				self::on_invoice_paid( $object );
				break;
			case 'invoice.payment_failed':
				self::on_invoice_failed( $object );
				break;
			case 'customer.subscription.updated':
			case 'customer.subscription.deleted':
				self::on_subscription_changed( $type, $object );
				break;
		}
	}

	/** Activate the local record and link a client once Checkout completes. */
	private static function on_checkout_completed( array $session ) {
		if ( isset( $session['mode'] ) && 'subscription' !== $session['mode'] ) {
			return;
		}

		$meta   = isset( $session['metadata'] ) && is_array( $session['metadata'] ) ? $session['metadata'] : array();
		$sub_id = isset( $meta['subscription_id'] ) ? (int) $meta['subscription_id'] : 0;
		$sub    = $sub_id ? HGD_Subscription::get( $sub_id ) : null;
		if ( ! $sub && isset( $session['id'] ) ) {
			$sub = HGD_Subscription::find_by_session( (string) $session['id'] );
		}
		if ( ! $sub ) {
			return;
		}

		$update = array(
			'status'             => 'active',
			'stripe_customer_id' => sanitize_text_field( isset( $session['customer'] ) ? (string) $session['customer'] : '' ),
			'stripe_subscription_id' => sanitize_text_field( isset( $session['subscription'] ) ? (string) $session['subscription'] : '' ),
		);

		// Link (or create) a CRM client for the subscriber.
		if ( empty( $sub['client_id'] ) ) {
			$parts = preg_split( '/\s+/', trim( (string) $sub['name'] ), 2 );
			$update['client_id'] = HGD_Client::find_or_create( array(
				'first_name' => isset( $parts[0] ) ? $parts[0] : '',
				'last_name'  => isset( $parts[1] ) ? $parts[1] : '',
				'email'      => (string) $sub['email'],
				'phone'      => (string) $sub['phone'],
				'postcode'   => (string) $sub['postcode'],
			) );
		}

		HGD_Subscription::update( (int) $sub['id'], $update );
	}

	/** Advance the period and mirror the paid invoice into WooCommerce. */
	private static function on_invoice_paid( array $invoice ) {
		$sub_id = isset( $invoice['subscription'] ) ? (string) $invoice['subscription'] : '';
		$sub    = $sub_id ? HGD_Subscription::find_by_stripe_id( $sub_id ) : null;

		// Stripe doesn't guarantee checkout.session.completed arrives first, so
		// the local row may not yet carry the subscription id. Self-heal by
		// reading our subscription_id back from the Stripe subscription metadata.
		if ( ! $sub && '' !== $sub_id ) {
			$sub = self::backfill_from_stripe( $sub_id, $invoice );
		}
		if ( ! $sub ) {
			return;
		}

		$update = array( 'status' => 'active' );
		$end    = self::invoice_period_end( $invoice );
		if ( $end ) {
			$update['current_period_end'] = $end;
		}
		HGD_Subscription::update( (int) $sub['id'], $update );

		// Mirror to a Woo order so Woo keeps the record + sends a receipt.
		if ( HGD_Woo::is_active() ) {
			HGD_Woo::create_subscription_invoice_order( HGD_Subscription::get( (int) $sub['id'] ), $invoice );
		}
	}

	/**
	 * Locate (and link) the local row from a Stripe subscription id when an
	 * event arrives before checkout.session.completed. Returns the fresh row or
	 * null. Idempotent: only fills blank ids.
	 */
	private static function backfill_from_stripe( $sub_id, array $invoice ) {
		$stripe_sub = HGD_Stripe::retrieve_subscription( $sub_id );
		if ( is_wp_error( $stripe_sub ) || empty( $stripe_sub['metadata']['subscription_id'] ) ) {
			return null;
		}
		$row_id = (int) $stripe_sub['metadata']['subscription_id'];
		$sub    = $row_id ? HGD_Subscription::get( $row_id ) : null;
		if ( ! $sub ) {
			return null;
		}

		HGD_Subscription::update( $row_id, array(
			'status'                 => 'active',
			'stripe_subscription_id' => sanitize_text_field( (string) $sub_id ),
			'stripe_customer_id'     => sanitize_text_field( isset( $invoice['customer'] ) ? (string) $invoice['customer'] : (string) $sub['stripe_customer_id'] ),
		) );
		return HGD_Subscription::get( $row_id );
	}

	/** A failed charge: Stripe Smart Retries + dunning emails take over. */
	private static function on_invoice_failed( array $invoice ) {
		$sub_id = isset( $invoice['subscription'] ) ? (string) $invoice['subscription'] : '';
		$sub    = $sub_id ? HGD_Subscription::find_by_stripe_id( $sub_id ) : null;
		if ( ! $sub ) {
			return;
		}
		HGD_Subscription::update( (int) $sub['id'], array( 'status' => 'past_due' ) );
	}

	/** Sync status (and cancellation) from subscription lifecycle events. */
	private static function on_subscription_changed( $type, array $object ) {
		$sub_id = isset( $object['id'] ) ? (string) $object['id'] : '';
		$sub    = $sub_id ? HGD_Subscription::find_by_stripe_id( $sub_id ) : null;
		if ( ! $sub ) {
			return;
		}

		if ( 'customer.subscription.deleted' === $type ) {
			HGD_Subscription::update( (int) $sub['id'], array(
				'status'      => 'canceled',
				'canceled_at' => current_time( 'mysql' ),
			) );
			return;
		}

		// updated: map Stripe status onto ours.
		$stripe_status = isset( $object['status'] ) ? (string) $object['status'] : '';
		$map = array(
			'active'             => 'active',
			'trialing'           => 'active',
			'past_due'           => 'past_due',
			'unpaid'             => 'past_due',
			'canceled'           => 'canceled',
			'incomplete'         => 'incomplete',
			'incomplete_expired' => 'canceled',
		);
		$update = array();
		if ( isset( $map[ $stripe_status ] ) ) {
			$update['status'] = $map[ $stripe_status ];
		}
		if ( ! empty( $object['current_period_end'] ) ) {
			$update['current_period_end'] = self::ts_to_mysql( (int) $object['current_period_end'] );
		}
		if ( ! empty( $object['canceled_at'] ) ) {
			$update['canceled_at'] = self::ts_to_mysql( (int) $object['canceled_at'] );
		}
		if ( $update ) {
			HGD_Subscription::update( (int) $sub['id'], $update );
		}
	}

	/** Period end from an invoice (line period end, falling back to invoice end). */
	private static function invoice_period_end( array $invoice ) {
		if ( ! empty( $invoice['lines']['data'][0]['period']['end'] ) ) {
			return self::ts_to_mysql( (int) $invoice['lines']['data'][0]['period']['end'] );
		}
		if ( ! empty( $invoice['period_end'] ) ) {
			return self::ts_to_mysql( (int) $invoice['period_end'] );
		}
		return '';
	}

	/** Unix timestamp → site-local MySQL datetime. */
	private static function ts_to_mysql( $ts ) {
		if ( $ts <= 0 ) {
			return '';
		}
		return ( new DateTimeImmutable( '@' . $ts ) )
			->setTimezone( wp_timezone() )
			->format( 'Y-m-d H:i:s' );
	}

	// -------------------------------------------------------------------------
	// Shortcode UI
	// -------------------------------------------------------------------------

	public static function shortcode( $atts ) {
		wp_enqueue_style( 'hgd-fonts', HGD_URL . 'assets/fonts/fonts.css', array(), HGD_VERSION );
		wp_enqueue_style( 'hgd-subscriptions', HGD_URL . 'assets/subscriptions/css/subscriptions.css', array( 'hgd-fonts' ), HGD_VERSION );

		$configured = self::is_configured();
		$plans      = HGD_Subscription::plans();
		$state      = isset( $_GET['hgd_sub'] ) ? sanitize_key( wp_unslash( $_GET['hgd_sub'] ) ) : '';

		// On return from a successful Checkout, offer a self-service link.
		$manage_url = '';
		if ( 'success' === $state && isset( $_GET['session_id'] ) ) {
			$session_id = sanitize_text_field( wp_unslash( $_GET['session_id'] ) );
			$paid_sub   = $session_id ? HGD_Subscription::find_by_session( $session_id ) : null;
			if ( $paid_sub ) {
				$manage_url = HGD_Subscription::manage_url( $paid_sub );
			}
		}

		if ( $configured ) {
			wp_enqueue_script( 'hgd-subscriptions', HGD_URL . 'assets/subscriptions/js/subscriptions.js', array(), HGD_VERSION, true );
			wp_localize_script( 'hgd-subscriptions', 'HGD_SUBS', array(
				'rest'  => esc_url_raw( rest_url( self::NS ) ),
				'nonce' => wp_create_nonce( 'wp_rest' ),
				'i18n'  => array(
					'error'    => __( 'Something went wrong. Please try again.', 'hillcroft-garden-designer' ),
					'redirect' => __( 'Redirecting to secure checkout…', 'hillcroft-garden-designer' ),
					'fields'   => __( 'Please enter your name and a valid email.', 'hillcroft-garden-designer' ),
				),
			) );
		}

		ob_start();
		?>
		<div class="hgd-subs" data-configured="<?php echo $configured ? '1' : '0'; ?>">
			<?php if ( 'success' === $state ) : ?>
				<div class="hgd-subs-notice hgd-subs-success">
					<h3><?php esc_html_e( 'You\'re all set — welcome aboard!', 'hillcroft-garden-designer' ); ?></h3>
					<p><?php esc_html_e( 'Your maintenance plan is active. A receipt is on its way by email, and we\'ll be in touch to schedule your first visit.', 'hillcroft-garden-designer' ); ?></p>
					<?php if ( '' !== $manage_url ) : ?>
						<p><a class="hgd-subs-manage-link" href="<?php echo esc_url( $manage_url ); ?>"><?php esc_html_e( 'Manage your plan', 'hillcroft-garden-designer' ); ?></a></p>
					<?php endif; ?>
				</div>
			<?php elseif ( 'cancel' === $state ) : ?>
				<div class="hgd-subs-notice hgd-subs-cancel">
					<p><?php esc_html_e( 'No problem — your sign-up was cancelled and you haven\'t been charged. Choose a plan below whenever you\'re ready.', 'hillcroft-garden-designer' ); ?></p>
				</div>
			<?php endif; ?>

			<?php if ( ! $configured ) : ?>
				<div class="hgd-subs-notice"><?php esc_html_e( 'Plan sign-up is not yet available. Please check back soon.', 'hillcroft-garden-designer' ); ?></div>
			<?php else : ?>
				<div class="hgd-subs-grid">
					<?php foreach ( $plans as $key => $plan ) :
						$interval = isset( $plan['interval'] ) ? $plan['interval'] : 'month'; ?>
						<div class="hgd-subs-card" data-plan="<?php echo esc_attr( $key ); ?>">
							<h3 class="hgd-subs-name"><?php echo esc_html( $plan['label'] ); ?></h3>
							<p class="hgd-subs-price">
								<span class="hgd-subs-amount">£<?php echo esc_html( number_format( (float) $plan['price'], 2 ) ); ?></span>
								<span class="hgd-subs-interval">/ <?php echo esc_html( $interval ); ?></span>
							</p>
							<?php if ( ! empty( $plan['blurb'] ) ) : ?>
								<p class="hgd-subs-blurb"><?php echo esc_html( $plan['blurb'] ); ?></p>
							<?php endif; ?>
							<?php if ( ! empty( $plan['features'] ) ) : ?>
								<ul class="hgd-subs-features">
									<?php foreach ( (array) $plan['features'] as $f ) : ?>
										<li><?php echo esc_html( $f ); ?></li>
									<?php endforeach; ?>
								</ul>
							<?php endif; ?>
							<button type="button" class="hgd-subs-choose" data-plan="<?php echo esc_attr( $key ); ?>">
								<?php esc_html_e( 'Choose plan', 'hillcroft-garden-designer' ); ?>
							</button>
						</div>
					<?php endforeach; ?>
				</div>

				<form class="hgd-subs-form" hidden>
					<h3 class="hgd-subs-form-title"><?php esc_html_e( 'Your details', 'hillcroft-garden-designer' ); ?></h3>
					<p class="hgd-subs-chosen"></p>
					<input type="hidden" name="plan_key" value="">
					<label><?php esc_html_e( 'Full name', 'hillcroft-garden-designer' ); ?>
						<input type="text" name="name" required autocomplete="name">
					</label>
					<label><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?>
						<input type="email" name="email" required autocomplete="email">
					</label>
					<label><?php esc_html_e( 'Phone', 'hillcroft-garden-designer' ); ?>
						<input type="tel" name="phone" autocomplete="tel">
					</label>
					<label><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?>
						<input type="text" name="postcode" autocomplete="postal-code">
					</label>
					<div class="hgd-subs-error" role="alert" hidden></div>
					<div class="hgd-subs-actions">
						<button type="button" class="hgd-subs-back"><?php esc_html_e( 'Back', 'hillcroft-garden-designer' ); ?></button>
						<button type="submit" class="hgd-subs-submit"><?php esc_html_e( 'Continue to payment', 'hillcroft-garden-designer' ); ?></button>
					</div>
				</form>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * [hgd_manage_plan] — a small form where a returning subscriber enters their
	 * email to be sent a secure self-service link. Neutral response (no email
	 * enumeration). The actual portal opens via ?hgd_manage=<token>.
	 */
	public static function manage_shortcode( $atts ) {
		wp_enqueue_style( 'hgd-fonts', HGD_URL . 'assets/fonts/fonts.css', array(), HGD_VERSION );
		wp_enqueue_style( 'hgd-subscriptions', HGD_URL . 'assets/subscriptions/css/subscriptions.css', array( 'hgd-fonts' ), HGD_VERSION );
		wp_enqueue_script( 'hgd-subscriptions', HGD_URL . 'assets/subscriptions/js/subscriptions.js', array(), HGD_VERSION, true );
		wp_localize_script( 'hgd-subscriptions', 'HGD_SUBS', array(
			'rest'  => esc_url_raw( rest_url( self::NS ) ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'i18n'  => array(
				'error'    => __( 'Something went wrong. Please try again.', 'hillcroft-garden-designer' ),
				'redirect' => __( 'Redirecting to secure checkout…', 'hillcroft-garden-designer' ),
				'fields'   => __( 'Please enter your name and a valid email.', 'hillcroft-garden-designer' ),
				'sending'  => __( 'Sending…', 'hillcroft-garden-designer' ),
				'email'    => __( 'Please enter a valid email.', 'hillcroft-garden-designer' ),
			),
		) );

		ob_start();
		?>
		<div class="hgd-manage">
			<form class="hgd-manage-form">
				<h3 class="hgd-subs-form-title"><?php esc_html_e( 'Manage your plan', 'hillcroft-garden-designer' ); ?></h3>
				<p class="hgd-subs-blurb"><?php esc_html_e( 'Enter the email you signed up with and we\'ll send you a secure link to update your card, view invoices or cancel.', 'hillcroft-garden-designer' ); ?></p>
				<label><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?>
					<input type="email" name="email" required autocomplete="email">
				</label>
				<div class="hgd-subs-error" role="alert" hidden></div>
				<div class="hgd-manage-done" hidden></div>
				<div class="hgd-subs-actions">
					<button type="submit" class="hgd-subs-submit"><?php esc_html_e( 'Send me a link', 'hillcroft-garden-designer' ); ?></button>
				</div>
			</form>
		</div>
		<?php
		return ob_get_clean();
	}
}

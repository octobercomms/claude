<?php
/**
 * Public booking experience.
 *
 * Registers the [hgd_booking] shortcode (an on-brand, multi-step booking UI with
 * embedded Stripe Elements) and the hgd/v1 REST routes that power it:
 *   - GET  /booking/slots          available slots
 *   - POST /booking/create         create a pending booking + Stripe PaymentIntent
 *   - POST /stripe/webhook         Stripe payment confirmation (no nonce)
 *
 * On a confirmed payment the booking becomes `paid`, a client + project are
 * created, a Google Calendar event is written (if connected), and confirmation
 * emails with an .ics invite go out.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Booking_Page {

	const NS = 'hgd/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_shortcode( 'hgd_booking', array( __CLASS__, 'shortcode' ) );
	}

	// -------------------------------------------------------------------------
	// REST routes
	// -------------------------------------------------------------------------

	public static function register_routes() {
		register_rest_route( self::NS, '/booking/slots', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'rest_slots' ),
		) );

		register_rest_route( self::NS, '/booking/create', array(
			'methods'             => 'POST',
			'permission_callback' => array( __CLASS__, 'create_permission' ),
			'callback'            => array( __CLASS__, 'rest_create' ),
		) );

		register_rest_route( self::NS, '/stripe/webhook', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'rest_webhook' ),
		) );
	}

	/** Nonce-protect the create route. */
	public static function create_permission( $request ) {
		$nonce = $request->get_header( 'X-WP-Nonce' );
		return (bool) wp_verify_nonce( $nonce, 'wp_rest' );
	}

	public static function rest_slots() {
		$s    = HGD_Settings::all();
		$from = (int) $s['booking_lead_days'];
		$to   = (int) $s['booking_window_days'];
		$days = HGD_Availability::slots( $from, $to );

		// Shape for the UI: ordered list of dates each with its slots.
		$dates = array();
		foreach ( $days as $date => $slots ) {
			$dates[] = array(
				'date'  => $date,
				'label' => mysql2date( 'l j F', $date ),
				'slots' => $slots,
			);
		}

		return new WP_REST_Response( array(
			'configured' => HGD_Stripe::is_configured() && '' !== (string) $s['stripe_pub_key'],
			'fee_gbp'    => (float) $s['consultation_fee_gbp'],
			'dates'      => $dates,
		), 200 );
	}

	public static function rest_create( $request ) {
		$s = HGD_Settings::all();

		if ( ! HGD_Stripe::is_configured() || '' === (string) $s['stripe_pub_key'] ) {
			return new WP_Error( 'hgd_not_configured', __( 'Online booking is not yet configured.', 'hillcroft-garden-designer' ), array( 'status' => 503 ) );
		}

		$name    = sanitize_text_field( (string) $request->get_param( 'name' ) );
		$email   = sanitize_email( (string) $request->get_param( 'email' ) );
		$phone   = sanitize_text_field( (string) $request->get_param( 'phone' ) );
		$address = sanitize_text_field( (string) $request->get_param( 'address' ) );
		$postcode = sanitize_text_field( (string) $request->get_param( 'postcode' ) );
		$notes   = sanitize_textarea_field( (string) $request->get_param( 'notes' ) );
		$slot_start = sanitize_text_field( (string) $request->get_param( 'slot_start' ) );
		$slot_end   = sanitize_text_field( (string) $request->get_param( 'slot_end' ) );

		if ( '' === $name || ! is_email( $email ) ) {
			return new WP_Error( 'hgd_bad_input', __( 'Please provide your name and a valid email address.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}
		if ( ! self::valid_datetime( $slot_start ) || ! self::valid_datetime( $slot_end ) ) {
			return new WP_Error( 'hgd_bad_slot', __( 'Please choose a valid time slot.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}

		// Re-check the slot is genuinely free (and matches a real bookable slot).
		if ( ! self::is_offered_slot( $slot_start, $slot_end ) || ! HGD_Availability::slot_is_free( $slot_start, $slot_end ) ) {
			return new WP_Error( 'hgd_slot_taken', __( 'Sorry, that slot has just been taken. Please pick another.', 'hillcroft-garden-designer' ), array( 'status' => 409 ) );
		}

		$fee = (float) $s['consultation_fee_gbp'];

		$booking_id = HGD_Booking::insert( array(
			'name'       => $name,
			'email'      => $email,
			'phone'      => $phone,
			'address'    => $address,
			'postcode'   => $postcode,
			'slot_start' => $slot_start,
			'slot_end'   => $slot_end,
			'status'     => 'pending',
			'amount_gbp' => $fee,
			'notes'      => $notes,
		) );

		if ( ! $booking_id ) {
			return new WP_Error( 'hgd_save_failed', __( 'Could not start your booking. Please try again.', 'hillcroft-garden-designer' ), array( 'status' => 500 ) );
		}

		$intent = HGD_Stripe::create_payment_intent(
			(int) round( $fee * 100 ),
			'gbp',
			array(
				'booking_id'  => (string) $booking_id,
				'consultation' => 'Hillcroft garden consultation',
			)
		);

		if ( is_wp_error( $intent ) ) {
			HGD_Booking::update( $booking_id, array( 'status' => 'cancelled' ) );
			return new WP_Error( 'hgd_stripe_failed', $intent->get_error_message(), array( 'status' => 502 ) );
		}

		HGD_Booking::update( $booking_id, array( 'stripe_payment_intent' => sanitize_text_field( $intent['id'] ) ) );

		return new WP_REST_Response( array(
			'booking_id'    => $booking_id,
			'client_secret' => $intent['client_secret'],
			'pub_key'       => (string) $s['stripe_pub_key'],
		), 200 );
	}

	// -------------------------------------------------------------------------
	// Stripe webhook
	// -------------------------------------------------------------------------

	public static function rest_webhook( $request ) {
		$payload = $request->get_body();
		$sig     = $request->get_header( 'stripe_signature' ); // WP normalises Stripe-Signature.
		if ( ! $sig && isset( $_SERVER['HTTP_STRIPE_SIGNATURE'] ) ) {
			$sig = sanitize_text_field( wp_unslash( $_SERVER['HTTP_STRIPE_SIGNATURE'] ) );
		}
		$secret  = (string) HGD_Settings::get( 'stripe_webhook_secret', '' );

		if ( ! HGD_Stripe::verify_webhook( $payload, $sig, $secret ) ) {
			return new WP_REST_Response( array( 'error' => 'invalid signature' ), 400 );
		}

		$event = json_decode( $payload, true );
		$type  = isset( $event['type'] ) ? $event['type'] : '';

		if ( 'payment_intent.succeeded' === $type ) {
			$pi      = isset( $event['data']['object'] ) ? $event['data']['object'] : array();
			$pi_id   = isset( $pi['id'] ) ? $pi['id'] : '';
			$meta    = isset( $pi['metadata'] ) && is_array( $pi['metadata'] ) ? $pi['metadata'] : array();

			// Proposal milestone payment (carries a payment_id / hgd_kind=payment).
			$payment_id = isset( $meta['payment_id'] ) ? (int) $meta['payment_id'] : 0;
			$is_payment = $payment_id || ( isset( $meta['hgd_kind'] ) && 'payment' === $meta['hgd_kind'] );

			if ( $is_payment ) {
				self::fulfil_payment( $payment_id, $pi_id );
				return new WP_REST_Response( array( 'received' => true ), 200 );
			}

			// Otherwise: existing consultation booking flow.
			$meta_id = isset( $meta['booking_id'] ) ? (int) $meta['booking_id'] : 0;
			$booking = $meta_id ? HGD_Booking::get( $meta_id ) : null;
			if ( ! $booking && $pi_id ) {
				$booking = HGD_Booking::find_by_payment_intent( $pi_id );
			}

			if ( $booking ) {
				self::fulfil_booking( $booking );
			}
		}

		return new WP_REST_Response( array( 'received' => true ), 200 );
	}

	/**
	 * Mark a booking paid and spin up the client/project/calendar/emails.
	 * Idempotent: a booking already `paid` is ignored.
	 */
	public static function fulfil_booking( array $booking ) {
		if ( 'paid' === $booking['status'] ) {
			return;
		}

		$booking_id = (int) $booking['id'];

		HGD_Booking::update( $booking_id, array( 'status' => 'paid' ) );

		// Client.
		$parts      = preg_split( '/\s+/', trim( $booking['name'] ), 2 );
		$first      = $parts[0];
		$last       = isset( $parts[1] ) ? $parts[1] : '';
		$client_id  = HGD_Client::find_or_create( array(
			'first_name' => $first,
			'last_name'  => $last,
			'email'      => $booking['email'],
			'phone'      => $booking['phone'],
			'postcode'   => $booking['postcode'],
		) );

		// Project.
		$slot_date = $booking['slot_start'] ? mysql2date( 'j M Y', $booking['slot_start'] ) : '';
		$project_id = HGD_Project::insert( array(
			'client_id'         => $client_id,
			'title'             => sprintf( '%s — consultation %s', $booking['name'], $slot_date ),
			'status'            => 'booked',
			'source'            => 'booking',
			'address'           => $booking['address'],
			'postcode'          => $booking['postcode'],
			'brief_notes'       => $booking['notes'],
			'consultation_paid' => 1,
			'consultation_at'   => $booking['slot_start'],
		) );

		$update = array(
			'client_id'  => $client_id,
			'project_id' => $project_id,
		);

		// Google Calendar event (optional).
		if ( HGD_Google_Calendar::is_connected() && $booking['slot_start'] && $booking['slot_end'] ) {
			$tz    = wp_timezone();
			$start = ( new DateTimeImmutable( $booking['slot_start'], $tz ) )->format( DateTimeInterface::RFC3339 );
			$end   = ( new DateTimeImmutable( $booking['slot_end'], $tz ) )->format( DateTimeInterface::RFC3339 );
			$desc  = sprintf(
				"Garden design consultation.\n\nClient: %s\nEmail: %s\nPhone: %s\nAddress: %s %s\n\nNotes: %s",
				$booking['name'], $booking['email'], $booking['phone'], $booking['address'], $booking['postcode'], $booking['notes']
			);
			$event_id = HGD_Google_Calendar::create_event(
				sprintf( 'Consultation — %s', $booking['name'] ),
				$desc,
				$start,
				$end,
				$booking['email']
			);
			if ( $event_id ) {
				$update['google_event_id'] = $event_id;
			}
		}

		HGD_Booking::update( $booking_id, $update );

		// Emails.
		$fresh = HGD_Booking::get( $booking_id );
		self::send_emails( $fresh ? $fresh : array_merge( $booking, $update ) );
	}

	/**
	 * Fulfil a proposal milestone payment from a succeeded PaymentIntent.
	 *
	 * Marks the HGD_Payment row paid, advances the proposal/project for a deposit,
	 * marks the proposal complete once all milestones are paid, and emails a
	 * receipt to the client + admin. Idempotent: an already-paid milestone is
	 * ignored.
	 *
	 * @param int    $payment_id Payment row id from metadata (may be 0).
	 * @param string $pi_id      Stripe PaymentIntent id (fallback lookup).
	 */
	public static function fulfil_payment( $payment_id, $pi_id ) {
		$payment = $payment_id ? HGD_Payment::get( (int) $payment_id ) : null;
		if ( ! $payment && $pi_id ) {
			$payment = HGD_Payment::find_by_payment_intent( $pi_id );
		}
		if ( ! $payment ) {
			return;
		}
		if ( 'paid' === $payment['status'] ) {
			return; // idempotent
		}

		HGD_Payment::mark_paid( (int) $payment['id'], $pi_id ? $pi_id : $payment['stripe_payment_intent'] );

		$proposal = HGD_Proposal::get( (int) $payment['proposal_id'] );
		if ( $proposal ) {
			// Deposit drives the proposal/project forward.
			if ( 'deposit' === $payment['milestone'] && ! in_array( $proposal['status'], array( 'deposit_paid', 'complete' ), true ) ) {
				HGD_Proposal::update( (int) $proposal['id'], array( 'status' => 'deposit_paid' ) );
				if ( ! empty( $proposal['project_id'] ) ) {
					HGD_Project::update( (int) $proposal['project_id'], array( 'status' => 'in_progress' ) );
				}
			}
			// All milestones paid → proposal complete.
			if ( HGD_Payment::all_paid( (int) $proposal['id'] ) ) {
				HGD_Proposal::update( (int) $proposal['id'], array( 'status' => 'complete' ) );
				if ( ! empty( $proposal['project_id'] ) ) {
					HGD_Project::update( (int) $proposal['project_id'], array( 'status' => 'complete' ) );
				}
			}
		}

		self::send_payment_receipt( HGD_Payment::get( (int) $payment['id'] ), $proposal );
	}

	/** Email a milestone-payment receipt to the client and admin. */
	private static function send_payment_receipt( $payment, $proposal ) {
		if ( ! $payment ) {
			return;
		}
		$site   = get_bloginfo( 'name' );
		$amount = '£' . number_format( (float) $payment['amount_gbp'], 2 );

		$project = ( $proposal && ! empty( $proposal['project_id'] ) ) ? HGD_Project::get( (int) $proposal['project_id'] ) : null;
		$client  = ( $project && ! empty( $project['client_id'] ) ) ? HGD_Client::get( (int) $project['client_id'] ) : null;
		$title   = $project ? (string) $project['title'] : __( 'your garden project', 'hillcroft-garden-designer' );

		if ( $client && ! empty( $client['email'] ) ) {
			$subject = sprintf( __( 'Payment received — %s', 'hillcroft-garden-designer' ), $title );
			$body    = sprintf(
				__( "Hi %s,\n\nThank you — we've received your %s payment (%s) for %s.\n\nWe'll be in touch with the next steps.\n\n%s", 'hillcroft-garden-designer' ),
				HGD_Client::full_name( $client ),
				$payment['label'],
				$amount,
				$title,
				$site
			);
			wp_mail( $client['email'], $subject, $body, self::mail_headers() );
		}

		$admin_subject = sprintf( __( 'Milestone paid — %s (%s)', 'hillcroft-garden-designer' ), $title, $amount );
		$admin_body    = sprintf(
			__( "A proposal milestone has been paid.\n\nProject: %s\nMilestone: %s\nAmount: %s\nClient: %s", 'hillcroft-garden-designer' ),
			$title,
			$payment['label'],
			$amount,
			$client ? HGD_Client::full_name( $client ) : __( '(unknown)', 'hillcroft-garden-designer' )
		);
		wp_mail( get_option( 'admin_email' ), $admin_subject, $admin_body, self::mail_headers() );
	}

	// -------------------------------------------------------------------------
	// Email + .ics
	// -------------------------------------------------------------------------

	private static function send_emails( array $booking ) {
		$site      = get_bloginfo( 'name' );
		$slot_long = $booking['slot_start'] ? mysql2date( 'l j F Y, g:ia', $booking['slot_start'] ) : '';
		$fee       = '£' . number_format( (float) $booking['amount_gbp'], 2 );

		$ics       = self::build_ics( $booking );
		$ics_path  = self::write_temp_ics( $ics, $booking );
		$attach    = $ics_path ? array( $ics_path ) : array();

		// Client confirmation.
		$client_subject = sprintf( __( 'Your garden consultation is booked — %s', 'hillcroft-garden-designer' ), $slot_long );
		$client_body    = sprintf(
			__( "Hi %s,\n\nThank you — your garden design consultation is confirmed.\n\nWhen: %s\nFee paid: %s\n\nWe've attached a calendar invite. We look forward to seeing you.\n\n%s", 'hillcroft-garden-designer' ),
			$booking['name'],
			$slot_long,
			$fee,
			$site
		);
		wp_mail( $booking['email'], $client_subject, $client_body, self::mail_headers(), $attach );

		// Admin notification.
		$admin_subject = sprintf( __( 'New paid consultation — %s', 'hillcroft-garden-designer' ), $booking['name'] );
		$admin_body    = sprintf(
			__( "A consultation has been booked and paid.\n\nName: %s\nEmail: %s\nPhone: %s\nWhen: %s\nAddress: %s %s\nFee: %s\nNotes: %s", 'hillcroft-garden-designer' ),
			$booking['name'],
			$booking['email'],
			$booking['phone'],
			$slot_long,
			$booking['address'],
			$booking['postcode'],
			$fee,
			$booking['notes']
		);
		wp_mail( get_option( 'admin_email' ), $admin_subject, $admin_body, self::mail_headers(), $attach );

		if ( $ics_path && file_exists( $ics_path ) ) {
			@unlink( $ics_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
	}

	private static function mail_headers() {
		return array( 'Content-Type: text/plain; charset=UTF-8' );
	}

	/** Build an RFC5545 VEVENT for the consultation. */
	public static function build_ics( array $booking ) {
		$tz   = wp_timezone();
		$fmt  = function ( $dt ) use ( $tz ) {
			try {
				$d = new DateTimeImmutable( $dt, $tz );
			} catch ( Exception $e ) {
				$d = new DateTimeImmutable( 'now', $tz );
			}
			return $d->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Ymd\THis\Z' );
		};

		$uid     = 'hgd-' . (int) $booking['id'] . '@' . wp_parse_url( home_url(), PHP_URL_HOST );
		$summary = self::ics_escape( sprintf( 'Garden consultation — %s', get_bloginfo( 'name' ) ) );
		$desc    = self::ics_escape( (string) $booking['notes'] );
		$loc     = self::ics_escape( trim( $booking['address'] . ' ' . $booking['postcode'] ) );

		$lines = array(
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Hillcroft Garden Designer//EN',
			'METHOD:PUBLISH',
			'BEGIN:VEVENT',
			'UID:' . $uid,
			'DTSTAMP:' . $fmt( current_time( 'mysql' ) ),
			'DTSTART:' . $fmt( $booking['slot_start'] ),
			'DTEND:' . $fmt( $booking['slot_end'] ),
			'SUMMARY:' . $summary,
			'DESCRIPTION:' . $desc,
			'LOCATION:' . $loc,
			'STATUS:CONFIRMED',
			'END:VEVENT',
			'END:VCALENDAR',
		);

		return implode( "\r\n", $lines ) . "\r\n";
	}

	private static function write_temp_ics( $ics, array $booking ) {
		$upload = wp_upload_dir();
		if ( ! empty( $upload['error'] ) ) {
			return '';
		}
		$file = trailingslashit( $upload['basedir'] ) . 'hgd-consultation-' . (int) $booking['id'] . '.ics';
		if ( false === file_put_contents( $file, $ics ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			return '';
		}
		return $file;
	}

	private static function ics_escape( $text ) {
		$text = str_replace( array( '\\', ';', ',' ), array( '\\\\', '\\;', '\\,' ), (string) $text );
		$text = str_replace( array( "\r\n", "\n", "\r" ), '\\n', $text );
		return $text;
	}

	// -------------------------------------------------------------------------
	// Validation helpers
	// -------------------------------------------------------------------------

	private static function valid_datetime( $value ) {
		return (bool) preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value );
	}

	/** Confirm the submitted slot is one we actually offered (defence in depth). */
	private static function is_offered_slot( $start, $end ) {
		$s    = HGD_Settings::all();
		$days = HGD_Availability::slots( (int) $s['booking_lead_days'], (int) $s['booking_window_days'] );
		$date = substr( $start, 0, 10 );
		if ( ! isset( $days[ $date ] ) ) {
			return false;
		}
		foreach ( $days[ $date ] as $slot ) {
			if ( $slot['start'] === $start && $slot['end'] === $end ) {
				return true;
			}
		}
		return false;
	}

	// -------------------------------------------------------------------------
	// Shortcode UI
	// -------------------------------------------------------------------------

	public static function shortcode( $atts ) {
		$s = HGD_Settings::all();

		wp_enqueue_style( 'hgd-booking', HGD_URL . 'assets/booking/css/booking.css', array(), HGD_VERSION );

		$configured = HGD_Stripe::is_configured() && '' !== (string) $s['stripe_pub_key'];

		if ( $configured ) {
			wp_enqueue_script( 'stripe-js', 'https://js.stripe.com/v3/', array(), null, true );
			wp_enqueue_script( 'hgd-booking', HGD_URL . 'assets/booking/js/booking.js', array( 'stripe-js' ), HGD_VERSION, true );
			wp_localize_script( 'hgd-booking', 'HGD_BOOKING', array(
				'rest'    => esc_url_raw( rest_url( self::NS ) ),
				'nonce'   => wp_create_nonce( 'wp_rest' ),
				'pub_key' => (string) $s['stripe_pub_key'],
				'fee'     => number_format( (float) $s['consultation_fee_gbp'], 2 ),
				'i18n'    => array(
					'taken'   => __( 'That slot was just taken — please pick another.', 'hillcroft-garden-designer' ),
					'error'   => __( 'Something went wrong. Please try again.', 'hillcroft-garden-designer' ),
					'paying'  => __( 'Processing payment…', 'hillcroft-garden-designer' ),
				),
			) );
		}

		ob_start();
		?>
		<div class="hgd-booking" data-configured="<?php echo $configured ? '1' : '0'; ?>">
			<?php if ( ! $configured ) : ?>
				<div class="hgd-booking-notice"><?php esc_html_e( 'Online booking is not yet available. Please check back soon.', 'hillcroft-garden-designer' ); ?></div>
			<?php else : ?>
				<div class="hgd-booking-head">
					<h2><?php esc_html_e( 'Book your garden consultation', 'hillcroft-garden-designer' ); ?></h2>
					<p class="hgd-booking-fee"><?php echo esc_html( sprintf( __( 'A %s consultation fee secures your visit.', 'hillcroft-garden-designer' ), '£' . number_format( (float) $s['consultation_fee_gbp'], 2 ) ) ); ?></p>
				</div>

				<ol class="hgd-booking-steps">
					<li class="is-active" data-step="date"><?php esc_html_e( 'Date', 'hillcroft-garden-designer' ); ?></li>
					<li data-step="slot"><?php esc_html_e( 'Time', 'hillcroft-garden-designer' ); ?></li>
					<li data-step="details"><?php esc_html_e( 'Your details', 'hillcroft-garden-designer' ); ?></li>
					<li data-step="pay"><?php esc_html_e( 'Payment', 'hillcroft-garden-designer' ); ?></li>
				</ol>

				<div class="hgd-booking-panel" data-pane="date">
					<p class="hgd-booking-loading"><?php esc_html_e( 'Loading available dates…', 'hillcroft-garden-designer' ); ?></p>
					<div class="hgd-booking-dates"></div>
				</div>

				<div class="hgd-booking-panel" data-pane="slot" hidden>
					<button type="button" class="hgd-booking-back"><?php esc_html_e( '← Back to dates', 'hillcroft-garden-designer' ); ?></button>
					<h3 class="hgd-booking-chosen-date"></h3>
					<div class="hgd-booking-slots"></div>
				</div>

				<div class="hgd-booking-panel" data-pane="details" hidden>
					<button type="button" class="hgd-booking-back"><?php esc_html_e( '← Back to times', 'hillcroft-garden-designer' ); ?></button>
					<p class="hgd-booking-chosen-slot"></p>
					<div class="hgd-booking-fields">
						<label><span><?php esc_html_e( 'Full name', 'hillcroft-garden-designer' ); ?>*</span><input type="text" name="name" required /></label>
						<label><span><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?>*</span><input type="email" name="email" required /></label>
						<label><span><?php esc_html_e( 'Phone', 'hillcroft-garden-designer' ); ?></span><input type="tel" name="phone" /></label>
						<label><span><?php esc_html_e( 'Address', 'hillcroft-garden-designer' ); ?></span><input type="text" name="address" /></label>
						<label><span><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?></span><input type="text" name="postcode" /></label>
						<label class="hgd-booking-full"><span><?php esc_html_e( 'Anything we should know?', 'hillcroft-garden-designer' ); ?></span><textarea name="notes" rows="3"></textarea></label>
					</div>
					<p class="hgd-booking-err" hidden></p>
					<button type="button" class="hgd-booking-btn hgd-booking-continue"><?php esc_html_e( 'Continue to payment', 'hillcroft-garden-designer' ); ?></button>
				</div>

				<div class="hgd-booking-panel" data-pane="pay" hidden>
					<button type="button" class="hgd-booking-back"><?php esc_html_e( '← Back', 'hillcroft-garden-designer' ); ?></button>
					<p class="hgd-booking-summary"></p>
					<div class="hgd-booking-payment-element"></div>
					<p class="hgd-booking-err" hidden></p>
					<button type="button" class="hgd-booking-btn hgd-booking-pay"><?php echo esc_html( sprintf( __( 'Pay £%s & confirm', 'hillcroft-garden-designer' ), number_format( (float) $s['consultation_fee_gbp'], 2 ) ) ); ?></button>
				</div>

				<div class="hgd-booking-panel hgd-booking-success" data-pane="done" hidden>
					<div class="hgd-booking-tick">✓</div>
					<h3><?php esc_html_e( 'You’re booked in!', 'hillcroft-garden-designer' ); ?></h3>
					<p><?php esc_html_e( 'A confirmation email with a calendar invite is on its way. We look forward to seeing you.', 'hillcroft-garden-designer' ); ?></p>
				</div>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}
}

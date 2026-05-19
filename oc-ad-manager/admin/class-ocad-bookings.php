<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Bookings {

	public function __construct() {
		add_action( 'admin_post_ocad_activate_booking', array( $this, 'handle_activate' ) );
		add_action( 'admin_post_ocad_decline_booking',  array( $this, 'handle_decline' ) );
	}

	public static function get_all() {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_bookings';
		return $wpdb->get_results( "SELECT * FROM {$table} ORDER BY created_at DESC" );
	}

	public static function get( $id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_bookings';
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
	}

	public static function update_status( $id, $status ) {
		global $wpdb;
		$wpdb->update( $wpdb->prefix . 'ocad_bookings', array( 'status' => $status ), array( 'id' => $id ) );
	}

	public static function page_bookings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'oc-ad-manager' ) );
		}

		$bookings = self::get_all();
		$currency = strtoupper( get_option( 'ocad_stripe_currency', 'USD' ) );

		$message = '';
		if ( isset( $_GET['ocad_message'] ) ) {
			$map = array(
				'activated' => array( 'success', 'Booking activated — campaign is now live.' ),
				'declined'  => array( 'warning', 'Booking declined.' ),
				'error'     => array( 'error',   'An error occurred.' ),
			);
			$key = sanitize_key( $_GET['ocad_message'] );
			if ( isset( $map[ $key ] ) ) {
				$message = $map[ $key ];
			}
		}
		?>
		<div class="wrap ocad-wrap">
			<h1><?php esc_html_e( 'Ad Bookings', 'oc-ad-manager' ); ?></h1>
			<hr class="wp-header-end">

			<?php if ( $message ) : ?>
				<div class="notice notice-<?php echo esc_attr( $message[0] ); ?> is-dismissible">
					<p><?php echo esc_html( $message[1] ); ?></p>
				</div>
			<?php endif; ?>

			<?php if ( empty( $bookings ) ) : ?>
				<p class="description">No bookings yet. Once advertisers submit the booking form, they will appear here.</p>
			<?php else : ?>
			<table class="wp-list-table widefat fixed striped ocad-table">
				<thead>
					<tr>
						<th style="width:140px;">Date</th>
						<th>Advertiser</th>
						<th style="width:160px;">Campaign / Package</th>
						<th style="width:90px;">Start</th>
						<th style="width:90px;">End</th>
						<th style="width:90px;">Amount</th>
						<th style="width:110px;">Status</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
				<?php foreach ( $bookings as $b ) :
					$amount_display = $b->amount_cents ? number_format( $b->amount_cents / 100, 2 ) . ' ' . $currency : '—';
					$status_map = array(
						'pending_payment' => array( 'ocad-badge ocad-badge--grey',   'Awaiting Payment' ),
						'paid'            => array( 'ocad-badge ocad-badge--orange',  'Paid — Review' ),
						'active'          => array( 'ocad-badge ocad-badge--green',   'Active' ),
						'declined'        => array( 'ocad-badge ocad-badge--red',     'Declined' ),
					);
					list( $badge_class, $badge_label ) = $status_map[ $b->status ] ?? array( 'ocad-badge', $b->status );
				?>
				<tr>
					<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $b->created_at ) ) ); ?></td>
					<td>
						<strong><?php echo esc_html( $b->name ); ?></strong>
						<?php if ( $b->company ) : ?><br><span class="description"><?php echo esc_html( $b->company ); ?></span><?php endif; ?>
						<br><a href="mailto:<?php echo esc_attr( $b->email ); ?>"><?php echo esc_html( $b->email ); ?></a>
					</td>
					<td>
						<strong><?php echo esc_html( $b->campaign_name ?: '—' ); ?></strong>
						<br><span class="description"><?php echo esc_html( $b->package_name ?: $b->format ); ?></span>
						<?php if ( $b->promo_code ) : ?>
							<br><span class="description"><?php echo esc_html( $b->promo_code . ' −' . $b->discount_pct . '%' ); ?></span>
						<?php endif; ?>
					</td>
					<td><?php echo esc_html( $b->start_date ); ?></td>
					<td><?php echo esc_html( $b->end_date ?: '—' ); ?></td>
					<td><?php echo esc_html( $amount_display ); ?></td>
					<td><span class="<?php echo esc_attr( $badge_class ); ?>"><?php echo esc_html( $badge_label ); ?></span></td>
					<td class="ocad-actions">
						<?php if ( $b->image_attachment_id ) : ?>
							<a href="<?php echo esc_url( wp_get_attachment_url( $b->image_attachment_id ) ); ?>" target="_blank" class="button button-small">Image</a>
						<?php endif; ?>
						<?php if ( $b->campaign_id ) : ?>
							<a href="<?php echo esc_url( admin_url( 'admin.php?page=ocad-add-campaign&campaign_id=' . $b->campaign_id ) ); ?>" class="button button-small">Campaign</a>
						<?php endif; ?>
						<?php if ( $b->status === 'paid' ) : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
								<input type="hidden" name="action" value="ocad_activate_booking">
								<input type="hidden" name="booking_id" value="<?php echo (int) $b->id; ?>">
								<?php wp_nonce_field( 'ocad_activate_' . $b->id ); ?>
								<button type="submit" class="button button-small button-primary">Activate</button>
							</form>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;"
							      onsubmit="return confirm('Decline this booking?');">
								<input type="hidden" name="action" value="ocad_decline_booking">
								<input type="hidden" name="booking_id" value="<?php echo (int) $b->id; ?>">
								<?php wp_nonce_field( 'ocad_decline_' . $b->id ); ?>
								<button type="submit" class="button button-small">Decline</button>
							</form>
						<?php endif; ?>
					</td>
				</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<?php endif; ?>
		</div>
		<?php
	}

	public function handle_activate() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permission denied.' );
		}

		$booking_id = absint( $_POST['booking_id'] ?? 0 );
		check_admin_referer( 'ocad_activate_' . $booking_id );

		$booking = self::get( $booking_id );
		if ( ! $booking || $booking->status !== 'paid' ) {
			wp_safe_redirect( add_query_arg( array( 'page' => 'ocad-bookings', 'ocad_message' => 'error' ), admin_url( 'admin.php' ) ) );
			exit;
		}

		$end_date = $booking->end_date ?: date( 'Y-m-d', strtotime( '+4 weeks' ) );

		// Determine campaign restrictions from package.
		$restrict_impressions = $booking->package_type === 'impressions' && $booking->package_quantity > 0 ? 1 : 0;
		$restrict_clicks      = $booking->package_type === 'clicks'      && $booking->package_quantity > 0 ? 1 : 0;

		// Create campaign.
		$campaign_id = OCAD_Campaign::create( array(
			'name'                 => $booking->campaign_name ?: ( $booking->company ?: $booking->name ),
			'client_name'          => $booking->company ?: $booking->name,
			'url'                  => $booking->destination_url,
			'status'               => 'active',
			'start_date'           => $booking->start_date,
			'end_date'             => $booking->end_date ?: $end_date,
			'restrict_impressions' => $restrict_impressions,
			'max_impressions'      => $restrict_impressions ? $booking->package_quantity : null,
			'restrict_clicks'      => $restrict_clicks,
			'max_clicks'           => $restrict_clicks ? $booking->package_quantity : null,
		) );

		// Save ads for each format that was uploaded.
		$format_map = array(
			'mpu'        => $booking->image_attachment_id,
			'leaderboard'=> $booking->image_attachment_id_lb,
			'skyscraper' => $booking->image_attachment_id_sky,
		);
		foreach ( $format_map as $fmt_key => $att_id ) {
			if ( $att_id ) {
				$image_url = wp_get_attachment_url( $att_id );
				if ( $image_url ) {
					OCAD_Campaign::save_ad( $campaign_id, $fmt_key, $image_url );
				}
			}
		}

		// Update booking.
		global $wpdb;
		$wpdb->update(
			$wpdb->prefix . 'ocad_bookings',
			array( 'status' => 'active', 'campaign_id' => $campaign_id ),
			array( 'id' => $booking_id )
		);

		// Email buyer.
		$end_formatted = date_i18n( get_option( 'date_format' ), strtotime( $end_date ) );
		wp_mail(
			$booking->email,
			'Your ad is now live — ' . get_bloginfo( 'name' ),
			"Hi,\n\nGreat news — your campaign \"{$booking->campaign_name}\" is now live and running until {$end_formatted}.\n\nThank you for advertising with us!\n\n" . get_bloginfo( 'name' )
		);

		wp_safe_redirect( add_query_arg( array( 'page' => 'ocad-bookings', 'ocad_message' => 'activated' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public function handle_decline() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permission denied.' );
		}

		$booking_id = absint( $_POST['booking_id'] ?? 0 );
		check_admin_referer( 'ocad_decline_' . $booking_id );

		self::update_status( $booking_id, 'declined' );

		$booking = self::get( $booking_id );
		if ( $booking ) {
			wp_mail(
				$booking->email,
				'Ad booking update — ' . get_bloginfo( 'name' ),
				"Hi {$booking->name},\n\nUnfortunately we are unable to proceed with your ad booking at this time. Please get in touch if you have any questions.\n\n" . get_bloginfo( 'name' )
			);
		}

		wp_safe_redirect( add_query_arg( array( 'page' => 'ocad-bookings', 'ocad_message' => 'declined' ), admin_url( 'admin.php' ) ) );
		exit;
	}
}

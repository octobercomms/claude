<?php
/**
 * Admin UI: the "Payment Links" dashboard (create form + log) and the action
 * handlers that talk to Stripe.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Admin {

	const CAP  = 'manage_options';
	const MENU = 'arpl';

	/** @var string[] Page hook suffixes for our screens, used to scope asset loading. */
	private static $hooks = [];

	public static function init() {
		add_action( 'admin_menu', [ __CLASS__, 'menu' ] );
		add_action( 'admin_enqueue_scripts', [ __CLASS__, 'assets' ] );

		// State-changing actions go through admin-post.php (POST + nonce + cap).
		add_action( 'admin_post_arpl_create', [ __CLASS__, 'handle_create' ] );
		add_action( 'admin_post_arpl_check', [ __CLASS__, 'handle_check' ] );
		add_action( 'admin_post_arpl_check_all', [ __CLASS__, 'handle_check_all' ] );
		add_action( 'admin_post_arpl_deactivate', [ __CLASS__, 'handle_deactivate' ] );
		add_action( 'admin_post_arpl_delete', [ __CLASS__, 'handle_delete' ] );
		add_action( 'admin_post_arpl_send', [ __CLASS__, 'handle_send' ] );
	}

	public static function menu() {
		self::$hooks['main'] = add_menu_page(
			'Payment Links',
			'Payment Links',
			self::CAP,
			self::MENU,
			[ __CLASS__, 'render' ],
			'dashicons-money-alt',
			56
		);
		// Rename the auto-added first submenu item ("Payment Links") and keep it first.
		add_submenu_page( self::MENU, 'Payment Links', 'Create &amp; Log', self::CAP, self::MENU, [ __CLASS__, 'render' ] );
		self::$hooks['settings'] = add_submenu_page(
			self::MENU,
			'Payment Links — Settings',
			'Settings',
			self::CAP,
			'arpl-settings',
			[ 'ARPL_Settings', 'render_page' ]
		);
	}

	public static function assets( $hook ) {
		if ( ! in_array( $hook, self::$hooks, true ) ) {
			return;
		}
		wp_enqueue_style( 'arpl-admin', ARPL_URL . 'assets/css/admin.css', [], ARPL_VERSION );

		if ( $hook === ( self::$hooks['main'] ?? '' ) ) {
			wp_enqueue_script( 'arpl-qrcode', ARPL_URL . 'assets/js/qrcode.min.js', [], '1.0.0', true );
			wp_enqueue_script( 'arpl-admin', ARPL_URL . 'assets/js/admin.js', [ 'arpl-qrcode' ], ARPL_VERSION, true );
		}
	}

	// ---- Action handlers ---------------------------------------------------

	private static function guard( $nonce_action ) {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'You do not have permission to do that.' );
		}
		check_admin_referer( $nonce_action );
	}

	private static function redirect( array $args ) {
		$url = add_query_arg(
			array_merge( [ 'page' => self::MENU ], $args ),
			admin_url( 'admin.php' )
		);
		wp_safe_redirect( $url );
		exit;
	}

	public static function handle_create() {
		self::guard( 'arpl_create' );

		$customer = isset( $_POST['customer'] ) ? sanitize_text_field( wp_unslash( $_POST['customer'] ) ) : '';
		$email    = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$note     = isset( $_POST['note'] ) ? sanitize_textarea_field( wp_unslash( $_POST['note'] ) ) : '';
		$amount_raw = isset( $_POST['amount'] ) ? wp_unslash( $_POST['amount'] ) : '';
		$currency = isset( $_POST['currency'] )
			? strtolower( preg_replace( '/[^a-zA-Z]/', '', $_POST['currency'] ) )
			: ARPL_Settings::get( 'currency', 'gbp' );

		$minor = self::to_minor_units( $amount_raw );
		if ( null === $minor || $minor < 1 ) {
			self::redirect( [ 'arpl_msg' => 'bad_amount' ] );
		}
		if ( '' === $customer ) {
			self::redirect( [ 'arpl_msg' => 'no_customer' ] );
		}

		$stripe = ARPL_Settings::stripe();
		if ( ! $stripe->has_key() ) {
			self::redirect( [ 'arpl_msg' => 'no_key' ] );
		}

		$result = $stripe->create_payment_link( $minor, $currency, $customer, $note );
		if ( is_wp_error( $result ) ) {
			set_transient( 'arpl_error_' . get_current_user_id(), $result->get_error_message(), 60 );
			self::redirect( [ 'arpl_msg' => 'stripe_error' ] );
		}

		$id = ARPL_Store::insert( [
			'customer'        => $customer,
			'email'           => $email,
			'note'            => $note,
			'amount'          => $minor,
			'currency'        => $currency,
			'mode'            => ARPL_Settings::mode(),
			'stripe_price_id' => $result['price_id'],
			'stripe_link_id'  => $result['link_id'],
			'url'             => $result['url'],
		] );

		// If we have an email, jump straight to the editable draft so Ian can send it.
		if ( is_email( $email ) ) {
			self::redirect( [ 'arpl_compose' => $id, 'kind' => 'initial', 'arpl_msg' => 'created_compose' ] );
		}
		self::redirect( [ 'arpl_msg' => 'created', 'arpl_new' => $id ] );
	}

	public static function handle_check() {
		self::guard( 'arpl_check' );
		$id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		self::refresh_one( $id );
		self::redirect( [ 'arpl_msg' => 'checked' ] );
	}

	public static function handle_check_all() {
		self::guard( 'arpl_check_all' );
		$rows = ARPL_Store::all();
		$n    = 0;
		foreach ( $rows as $row ) {
			if ( 'paid' !== $row->status && (int) $row->active === 1 ) {
				self::refresh_one( (int) $row->id );
				$n++;
			}
		}
		self::redirect( [ 'arpl_msg' => 'checked_all', 'arpl_n' => $n ] );
	}

	/**
	 * Query Stripe for one row's status and persist any change.
	 */
	private static function refresh_one( $id ) {
		$row = ARPL_Store::get( $id );
		if ( ! $row || '' === $row->stripe_link_id ) {
			return;
		}
		$stripe = ARPL_Settings::stripe();
		$status = $stripe->get_link_status( $row->stripe_link_id );
		if ( is_wp_error( $status ) ) {
			set_transient( 'arpl_error_' . get_current_user_id(), $status->get_error_message(), 60 );
			return;
		}

		if ( $status['paid'] && 'paid' !== $row->status ) {
			$fields  = [
				'status'      => 'paid',
				'amount_paid' => $status['amount_paid'],
				'paid_at'     => $status['paid_at'] ? gmdate( 'Y-m-d H:i:s', $status['paid_at'] ) : current_time( 'mysql', true ),
				'checked_at'  => current_time( 'mysql' ),
			];
			$formats = [ '%s', '%d', '%s', '%s' ];

			// Optionally close the link so it can't be paid again.
			if ( ARPL_Settings::get( 'deactivate_on_paid', 1 ) && (int) $row->active === 1 ) {
				$stripe->set_link_active( $row->stripe_link_id, false );
				$fields['active']  = 0;
				$formats[]         = '%d';
			}
			ARPL_Store::update( $id, $fields, $formats );
			if ( ! ARPL_Store::has_event( $id, 'paid' ) ) {
				ARPL_Store::log_event( $id, 'paid' );
			}
		} else {
			ARPL_Store::update( $id, [ 'checked_at' => current_time( 'mysql' ) ], [ '%s' ] );
		}
	}

	public static function handle_deactivate() {
		self::guard( 'arpl_deactivate' );
		$id  = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		$row = ARPL_Store::get( $id );
		if ( $row && '' !== $row->stripe_link_id ) {
			$res = ARPL_Settings::stripe()->set_link_active( $row->stripe_link_id, false );
			if ( is_wp_error( $res ) ) {
				set_transient( 'arpl_error_' . get_current_user_id(), $res->get_error_message(), 60 );
				self::redirect( [ 'arpl_msg' => 'stripe_error' ] );
			}
			ARPL_Store::update( $id, [ 'active' => 0 ], [ '%d' ] );
		}
		self::redirect( [ 'arpl_msg' => 'deactivated' ] );
	}

	public static function handle_delete() {
		self::guard( 'arpl_delete' );
		$id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		if ( $id ) {
			ARPL_Store::delete( $id );
		}
		self::redirect( [ 'arpl_msg' => 'deleted' ] );
	}

	/**
	 * Send (or re-send as a reminder) the payment email for a link.
	 */
	public static function handle_send() {
		self::guard( 'arpl_send' );

		$id   = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		$kind = ( isset( $_POST['kind'] ) && 'reminder' === $_POST['kind'] ) ? 'reminder' : 'initial';
		$to   = isset( $_POST['to'] ) ? sanitize_email( wp_unslash( $_POST['to'] ) ) : '';
		$subject = isset( $_POST['subject'] ) ? sanitize_text_field( wp_unslash( $_POST['subject'] ) ) : '';
		$body    = isset( $_POST['body'] ) ? sanitize_textarea_field( wp_unslash( $_POST['body'] ) ) : '';

		$row = ARPL_Store::get( $id );
		if ( ! $row ) {
			self::redirect( [ 'arpl_msg' => 'deleted' ] );
		}
		if ( ! is_email( $to ) ) {
			set_transient( 'arpl_error_' . get_current_user_id(), 'Please enter a valid customer email address.', 60 );
			self::redirect( [ 'arpl_compose' => $id, 'kind' => $kind, 'arpl_msg' => 'send_error' ] );
		}
		if ( '' === trim( $subject ) || '' === trim( $body ) ) {
			set_transient( 'arpl_error_' . get_current_user_id(), 'The subject and message can\'t be empty.', 60 );
			self::redirect( [ 'arpl_compose' => $id, 'kind' => $kind, 'arpl_msg' => 'send_error' ] );
		}

		// Persist any change to the email address on the link, then send.
		if ( $to !== $row->email ) {
			ARPL_Store::update( $id, [ 'email' => $to ], [ '%s' ] );
			$row->email = $to;
		}

		$result = ARPL_Email::send( $row, $subject, $body );
		if ( is_wp_error( $result ) ) {
			set_transient( 'arpl_error_' . get_current_user_id(), $result->get_error_message(), 60 );
			self::redirect( [ 'arpl_compose' => $id, 'kind' => $kind, 'arpl_msg' => 'send_error' ] );
		}

		ARPL_Store::log_event( $id, 'reminder' === $kind ? 'reminder' : 'sent', $to );
		self::redirect( [ 'arpl_msg' => 'reminder' === $kind ? 'reminder_sent' : 'sent' ] );
	}

	// ---- Rendering ---------------------------------------------------------

	public static function render() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		// Compose / send screen for one link.
		$compose_id = isset( $_GET['arpl_compose'] ) ? absint( $_GET['arpl_compose'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( $compose_id ) {
			self::render_compose( $compose_id );
			return;
		}
		$mode     = ARPL_Settings::mode();
		$currency = ARPL_Settings::get( 'currency', 'gbp' );
		$has_key  = ARPL_Settings::stripe()->has_key();
		$new_id   = isset( $_GET['arpl_new'] ) ? absint( $_GET['arpl_new'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap arpl-wrap">
			<div class="arpl-hero">
				<div class="arpl-hero-text">
					<h1>Take a payment</h1>
					<p>Create a secure payment link for a customer's tour balance — then copy it, email it, or show the QR code.</p>
				</div>
				<span class="arpl-mode arpl-mode-<?php echo esc_attr( $mode ); ?>"><?php echo esc_html( strtolower( $mode ) ); ?> mode</span>
			</div>

			<?php // WordPress hoists admin notices to just after this marker — keep them
			// below the coloured hero so they stay readable (not white-on-terracotta). ?>
			<hr class="wp-header-end">

			<?php self::notices(); ?>

			<?php if ( ! $has_key ) : ?>
				<div class="notice notice-warning"><p>
					No Stripe <strong><?php echo esc_html( $mode ); ?></strong> secret key is set yet.
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=arpl-settings' ) ); ?>">Add it in Settings</a> to start taking payments.
				</p></div>
			<?php endif; ?>

			<div class="arpl-grid">
				<div class="arpl-card arpl-create">
					<h2>New payment link</h2>
					<p class="arpl-lead">The amount isn't fixed — just type whatever the customer owes today.</p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="arpl-form">
						<input type="hidden" name="action" value="arpl_create" />
						<?php wp_nonce_field( 'arpl_create' ); ?>

						<div class="arpl-field">
							<label for="arpl-customer">Who's paying?</label>
							<input type="text" id="arpl-customer" name="customer" required placeholder="e.g. John &amp; Jane Smith" />
						</div>

						<div class="arpl-field">
							<label for="arpl-email">Their email <span>(optional — to send the link straight away)</span></label>
							<input type="email" id="arpl-email" name="email" placeholder="e.g. john@example.com" />
						</div>

						<div class="arpl-field">
							<label for="arpl-note">What's it for? <span>(the customer sees this)</span></label>
							<textarea id="arpl-note" name="note" rows="2" placeholder="e.g. Final balance — India Architecture Tour, Feb 2026"></textarea>
						</div>

						<div class="arpl-field">
							<label for="arpl-amount">How much?</label>
							<div class="arpl-amount-row">
								<span class="arpl-amount-wrap">
									<span class="arpl-amount-cur"><?php echo esc_html( strtoupper( $currency ) ); ?></span>
									<input type="number" id="arpl-amount" name="amount" step="0.01" min="0.50" class="arpl-amount-input" required placeholder="0.00" />
								</span>
								<select name="currency" class="arpl-cur-select">
									<?php foreach ( [ 'gbp' => 'GBP', 'usd' => 'USD', 'eur' => 'EUR', 'aud' => 'AUD', 'cad' => 'CAD' ] as $code => $label ) : ?>
										<option value="<?php echo esc_attr( $code ); ?>" <?php selected( $currency, $code ); ?>><?php echo esc_html( $label ); ?></option>
									<?php endforeach; ?>
								</select>
							</div>
						</div>

						<button type="submit" class="arpl-btn arpl-btn-primary" <?php disabled( ! $has_key ); ?>>Generate payment link &rarr;</button>
					</form>
				</div>

				<div class="arpl-card arpl-help">
					<h2>How it works</h2>
					<ol class="arpl-steps">
						<li><span>1</span> Fill in the name, note and amount, then generate.</li>
						<li><span>2</span> Copy the link or show the QR code, and send it to your customer.</li>
						<li><span>3</span> They pay securely on Stripe — no card details ever touch your site.</li>
						<li><span>4</span> Hit <em>Refresh status</em> to see who's paid. Paid links close automatically<?php echo ARPL_Settings::get( 'deactivate_on_paid', 1 ) ? '' : ' (disabled in settings)'; ?>.</li>
					</ol>
				</div>
			</div>

			<?php self::render_log( $currency, $new_id ); ?>
		</div>

		<div id="arpl-qr-modal" class="arpl-modal" aria-hidden="true">
			<div class="arpl-modal-backdrop"></div>
			<div class="arpl-modal-box" role="dialog" aria-modal="true">
				<button type="button" class="arpl-modal-close" aria-label="Close">&times;</button>
				<h3 id="arpl-qr-title">Scan to pay</h3>
				<div id="arpl-qr-canvas"></div>
				<p id="arpl-qr-url" class="arpl-qr-url"></p>
			</div>
		</div>
		<?php
	}

	/**
	 * The editable email draft for one link (initial send or reminder).
	 */
	private static function render_compose( $id ) {
		$row = ARPL_Store::get( $id );
		if ( ! $row ) {
			echo '<div class="wrap arpl-wrap"><p>That payment link no longer exists. <a href="' . esc_url( admin_url( 'admin.php?page=arpl' ) ) . '">Back to links</a>.</p></div>';
			return;
		}
		$kind     = ( isset( $_GET['kind'] ) && 'reminder' === $_GET['kind'] ) ? 'reminder' : 'initial'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$draft    = ARPL_Email::draft( $row, $kind );
		$to       = $row->email ? $row->email : '';
		$is_remind = ( 'reminder' === $kind );
		$brevo    = '' !== trim( (string) ARPL_Settings::get( 'brevo_api_key', '' ) );
		$summary  = ARPL_Store::event_summary( $id );
		$back      = admin_url( 'admin.php?page=arpl' );
		?>
		<div class="wrap arpl-wrap">
			<div class="arpl-hero">
				<div class="arpl-hero-text">
					<h1><?php echo $is_remind ? 'Send a reminder' : 'Send the payment link'; ?></h1>
					<p>Review and tweak the message below, then send it straight to <?php echo esc_html( $row->customer ); ?>. The amount and a “Pay now” button are added for you.</p>
				</div>
				<a class="arpl-back" href="<?php echo esc_url( $back ); ?>">&larr; Back to links</a>
			</div>

			<hr class="wp-header-end">
			<?php self::notices(); ?>

			<div class="arpl-grid">
				<div class="arpl-card arpl-create">
					<h2><?php echo $is_remind ? 'Reminder email' : 'Payment email'; ?></h2>
					<p class="arpl-lead">Everything here is editable before it goes out.</p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="arpl-form">
						<input type="hidden" name="action" value="arpl_send" />
						<input type="hidden" name="id" value="<?php echo esc_attr( $id ); ?>" />
						<input type="hidden" name="kind" value="<?php echo esc_attr( $kind ); ?>" />
						<?php wp_nonce_field( 'arpl_send' ); ?>

						<div class="arpl-field">
							<label for="arpl-to">To</label>
							<input type="email" id="arpl-to" name="to" value="<?php echo esc_attr( $to ); ?>" required placeholder="customer@example.com" />
						</div>
						<div class="arpl-field">
							<label for="arpl-subject">Subject</label>
							<input type="text" id="arpl-subject" name="subject" value="<?php echo esc_attr( $draft['subject'] ); ?>" required />
						</div>
						<div class="arpl-field">
							<label for="arpl-body">Message</label>
							<textarea id="arpl-body" name="body" rows="10" required><?php echo esc_textarea( $draft['body'] ); ?></textarea>
						</div>

						<button type="submit" class="arpl-btn arpl-btn-primary"><?php echo $is_remind ? 'Send reminder &rarr;' : 'Send email &rarr;'; ?></button>
						<p class="arpl-lead" style="margin-top:14px;">
							<?php if ( $brevo ) : ?>
								Sends via Brevo. Opens, clicks and payment are tracked automatically.
							<?php else : ?>
								No Brevo key set, so this will send via the site's default mailer. Opens &amp; clicks are still tracked.
								<a href="<?php echo esc_url( admin_url( 'admin.php?page=arpl-settings' ) ); ?>">Add a Brevo key</a> for best deliverability.
							<?php endif; ?>
						</p>
					</form>
				</div>

				<div class="arpl-card arpl-help">
					<h2>Summary</h2>
					<dl class="arpl-summary">
						<dt>Customer</dt><dd><?php echo esc_html( $row->customer ); ?></dd>
						<dt>Amount due</dt><dd><strong><?php echo esc_html( self::format_money( $row->amount, $row->currency ) ); ?></strong></dd>
						<?php if ( $row->note ) : ?><dt>For</dt><dd><?php echo esc_html( $row->note ); ?></dd><?php endif; ?>
						<dt>Status</dt><dd><?php echo 'paid' === $row->status ? 'Paid' : ( (int) $row->active === 1 ? 'Unpaid' : 'Closed' ); ?></dd>
					</dl>
					<?php if ( $summary['sent']['count'] || $summary['reminder']['count'] ) : ?>
						<p class="arpl-lead" style="margin:6px 0 0;">
							Already emailed <?php echo (int) ( $summary['sent']['count'] + $summary['reminder']['count'] ); ?> time(s)<?php
							$last = $summary['reminder']['last'] ?: $summary['sent']['last'];
							if ( $last ) { echo ', last on ' . esc_html( mysql2date( 'j M Y', $last ) ); }
							?>.
						</p>
					<?php endif; ?>
					<?php if ( $row->url ) : ?>
						<p style="margin-top:14px;">
							<button type="button" class="button button-small arpl-copy" data-url="<?php echo esc_attr( $row->url ); ?>">Copy link</button>
							<a class="button button-small" href="<?php echo esc_url( $row->url ); ?>" target="_blank" rel="noopener">Open ↗</a>
						</p>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
	}

	private static function render_log( $default_currency, $new_id ) {
		$rows = ARPL_Store::all();
		?>
		<div class="arpl-log">
			<div class="arpl-log-head">
				<h2>Payment links</h2>
				<?php if ( $rows ) : ?>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="arpl_check_all" />
						<?php wp_nonce_field( 'arpl_check_all' ); ?>
						<button type="submit" class="button">↻ Refresh all unpaid</button>
					</form>
				<?php endif; ?>
			</div>

			<?php if ( ! $rows ) : ?>
				<p class="arpl-empty">No payment links yet. Create your first one above.</p>
			<?php else : ?>
				<table class="widefat striped arpl-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Customer</th>
							<th>Note</th>
							<th class="arpl-num">Amount</th>
							<th>Status</th>
							<th>Activity</th>
							<th>Link</th>
							<th class="arpl-actions-col">Actions</th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $rows as $row ) : ?>
							<?php self::render_row( $row, $new_id ); ?>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}

	private static function render_row( $row, $new_id ) {
		$is_new   = ( (int) $row->id === $new_id );
		$paid     = ( 'paid' === $row->status );
		$active   = ( (int) $row->active === 1 );
		$post_url = admin_url( 'admin-post.php' );
		$ev       = ARPL_Store::event_summary( $row->id );
		$emailed  = ( $ev['sent']['count'] + $ev['reminder']['count'] ) > 0;
		$compose  = admin_url( 'admin.php?page=arpl&arpl_compose=' . (int) $row->id );
		?>
		<tr class="<?php echo $is_new ? 'arpl-row-new' : ''; ?>">
			<td><?php echo esc_html( mysql2date( 'j M Y', $row->created_at ) ); ?>
				<?php if ( 'live' !== $row->mode ) : ?><br><span class="arpl-tag-test">test</span><?php endif; ?>
			</td>
			<td><?php echo esc_html( $row->customer ); ?></td>
			<td class="arpl-note-cell"><?php echo esc_html( $row->note ); ?></td>
			<td class="arpl-num"><?php echo esc_html( self::format_money( $row->amount, $row->currency ) ); ?></td>
			<td>
				<?php if ( $paid ) : ?>
					<span class="arpl-badge arpl-badge-paid">Paid</span>
					<?php if ( $row->paid_at ) : ?><br><span class="description"><?php echo esc_html( mysql2date( 'j M Y', $row->paid_at ) ); ?></span><?php endif; ?>
				<?php elseif ( ! $active ) : ?>
					<span class="arpl-badge arpl-badge-off">Closed</span>
				<?php else : ?>
					<span class="arpl-badge arpl-badge-unpaid">Unpaid</span>
				<?php endif; ?>
			</td>
			<td class="arpl-activity">
				<?php
				$chips = [];
				if ( $emailed ) {
					$n     = (int) ( $ev['sent']['count'] + $ev['reminder']['count'] );
					$chips[] = '<span class="arpl-chip arpl-chip-sent" title="Last: ' . esc_attr( mysql2date( 'j M Y, g:ia', $ev['reminder']['last'] ?: $ev['sent']['last'] ) ) . '">✉ Sent' . ( $n > 1 ? ' ×' . $n : '' ) . '</span>';
				}
				if ( $ev['opened']['count'] ) {
					$chips[] = '<span class="arpl-chip arpl-chip-open" title="Last: ' . esc_attr( mysql2date( 'j M Y, g:ia', $ev['opened']['last'] ) ) . '">👁 Opened</span>';
				}
				if ( $ev['clicked']['count'] ) {
					$chips[] = '<span class="arpl-chip arpl-chip-click" title="Last: ' . esc_attr( mysql2date( 'j M Y, g:ia', $ev['clicked']['last'] ) ) . '">↗ Clicked</span>';
				}
				echo $chips ? implode( ' ', $chips ) : '<span class="description">—</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				?>
			</td>
			<td>
				<?php if ( $row->url ) : ?>
					<div class="arpl-link-actions">
						<button type="button" class="button button-small arpl-copy" data-url="<?php echo esc_attr( $row->url ); ?>">Copy</button>
						<button type="button" class="button button-small arpl-qr" data-url="<?php echo esc_attr( $row->url ); ?>" data-label="<?php echo esc_attr( $row->customer ); ?>">QR</button>
						<a class="button button-small" href="<?php echo esc_url( $row->url ); ?>" target="_blank" rel="noopener">Open ↗</a>
					</div>
				<?php else : ?>
					<span class="description">—</span>
				<?php endif; ?>
			</td>
			<td class="arpl-actions-col">
				<?php if ( ! $paid && $active ) : ?>
					<a href="<?php echo esc_url( $compose . '&kind=' . ( $emailed ? 'reminder' : 'initial' ) ); ?>" class="button button-small button-primary arpl-inline"><?php echo $emailed ? '↻ Chase' : '✉ Send email'; ?></a>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="arpl-inline">
						<input type="hidden" name="action" value="arpl_check" />
						<input type="hidden" name="id" value="<?php echo esc_attr( $row->id ); ?>" />
						<?php wp_nonce_field( 'arpl_check' ); ?>
						<button type="submit" class="button button-small">Refresh status</button>
					</form>
					<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="arpl-inline">
						<input type="hidden" name="action" value="arpl_deactivate" />
						<input type="hidden" name="id" value="<?php echo esc_attr( $row->id ); ?>" />
						<?php wp_nonce_field( 'arpl_deactivate' ); ?>
						<button type="submit" class="button button-small button-link-delete" onclick="return confirm('Close this link so it can no longer be paid?');">Close</button>
					</form>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( $post_url ); ?>" class="arpl-inline">
					<input type="hidden" name="action" value="arpl_delete" />
					<input type="hidden" name="id" value="<?php echo esc_attr( $row->id ); ?>" />
					<?php wp_nonce_field( 'arpl_delete' ); ?>
					<button type="submit" class="button button-small button-link-delete" onclick="return confirm('Remove this row from the log? The Stripe link itself is not deleted.');">Delete</button>
				</form>
			</td>
		</tr>
		<?php
	}

	private static function notices() {
		$msg = isset( $_GET['arpl_msg'] ) ? sanitize_key( $_GET['arpl_msg'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( '' === $msg ) {
			return;
		}
		$error = get_transient( 'arpl_error_' . get_current_user_id() );
		delete_transient( 'arpl_error_' . get_current_user_id() );

		$map = [
			'created'      => [ 'success', 'Payment link created. Copy it below or show the QR code to your customer.' ],
			'created_compose' => [ 'success', 'Payment link created — here is the email, ready to review and send.' ],
			'sent'         => [ 'success', 'Email sent to the customer. You can chase later from the Activity column.' ],
			'reminder_sent' => [ 'success', 'Reminder sent. Send another any time from the Chase button.' ],
			'send_error'   => [ 'error', 'Could not send: ' . ( $error ? $error : 'something went wrong.' ) ],
			'checked'      => [ 'info', 'Status refreshed from Stripe.' ],
			'checked_all'  => [ 'info', sprintf( 'Refreshed %d unpaid link(s) from Stripe.', isset( $_GET['arpl_n'] ) ? absint( $_GET['arpl_n'] ) : 0 ) ],
			'deactivated'  => [ 'success', 'Link closed — it can no longer be paid.' ],
			'deleted'      => [ 'success', 'Row removed from the log.' ],
			'bad_amount'   => [ 'error', 'Please enter a valid amount greater than zero.' ],
			'no_customer'  => [ 'error', 'Please enter a customer name.' ],
			'no_key'       => [ 'error', 'No Stripe secret key is configured. Add one in Settings.' ],
			'stripe_error' => [ 'error', 'Stripe error: ' . ( $error ? $error : 'something went wrong.' ) ],
		];
		if ( ! isset( $map[ $msg ] ) ) {
			return;
		}
		[ $type, $text ] = $map[ $msg ];
		printf(
			'<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
			esc_attr( $type ),
			esc_html( $text )
		);
	}

	// ---- Helpers -----------------------------------------------------------

	/**
	 * Parse a user-typed amount ("1,234.56", "1234.5") into integer minor units.
	 * Assumes 2-decimal currencies (GBP/USD/EUR/AUD/CAD).
	 *
	 * @return int|null Minor units, or null if unparseable.
	 */
	private static function to_minor_units( $raw ) {
		$raw = trim( (string) $raw );
		$raw = str_replace( [ ',', ' ' ], '', $raw );
		$raw = preg_replace( '/[^0-9.]/', '', $raw );
		if ( '' === $raw || ! is_numeric( $raw ) ) {
			return null;
		}
		return (int) round( (float) $raw * 100 );
	}

	private static function format_money( $minor, $currency ) {
		$symbols = [ 'gbp' => '£', 'usd' => '$', 'eur' => '€', 'aud' => 'A$', 'cad' => 'C$' ];
		$symbol  = $symbols[ strtolower( $currency ) ] ?? '';
		$amount  = number_format( ( (int) $minor ) / 100, 2 );
		return $symbol ? $symbol . $amount : strtoupper( $currency ) . ' ' . $amount;
	}
}

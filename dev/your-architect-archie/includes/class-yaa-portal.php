<?php
/**
 * Client portal — the [archie_portal] page.
 *
 * A token-gated (no-login) page: the unguessable ?token= in the URL identifies the
 * project. It shows the confirmed project + fixed price, an embedded Stripe Payment
 * Element while unpaid (a receipt once paid), the client's own uploads, and Tiam's
 * drawings/documents — drawings served watermarked + blurred until payment clears.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Portal {

	public static function init() {
		add_shortcode( 'archie_portal', array( __CLASS__, 'render' ) );
		// Consume a one-click sign-in link (sets the 7-day trusted-browser cookie)
		// before any output, then redirect to the clean portal URL.
		add_action( 'template_redirect', array( __CLASS__, 'maybe_consume_magic' ) );
		// Portal actions (work for logged-out visitors too).
		add_action( 'admin_post_nopriv_yaa_portal_signin', array( __CLASS__, 'act_signin' ) );
		add_action( 'admin_post_yaa_portal_signin', array( __CLASS__, 'act_signin' ) );
		add_action( 'admin_post_nopriv_yaa_portal_revision', array( __CLASS__, 'act_revision' ) );
		add_action( 'admin_post_yaa_portal_revision', array( __CLASS__, 'act_revision' ) );
	}

	// -------------------------------------------------------------------------
	// Access control — one-click email sign-in + a 7-day trusted-browser session.
	// The token in the URL identifies the project; a valid magic link (emailed to
	// the address on file) proves it's really them and drops a signed 7-day cookie,
	// so only the emailed recipient — and this browser, for a week — can view.
	// -------------------------------------------------------------------------
	const SESSION_DAYS = 7;
	const MAGIC_DAYS   = 14;

	private static function secret() {
		return wp_salt( 'auth' );
	}
	private static function magic_sig( $token, $exp ) {
		return hash_hmac( 'sha256', $token . '|' . (int) $exp, self::secret() );
	}
	/** A one-click sign-in URL for the project (valid for MAGIC_DAYS). */
	public static function magic_url( $project ) {
		$token = YAA_Project::ensure_token( is_object( $project ) ? $project->id : (int) $project );
		if ( ! is_object( $project ) ) {
			$project = YAA_Project::get( (int) $project );
		}
		$exp = time() + self::MAGIC_DAYS * DAY_IN_SECONDS;
		return add_query_arg(
			array( 'token' => $token, 'e' => $exp, 'k' => self::magic_sig( $token, $exp ) ),
			self::base_url()
		);
	}
	private static function verify_magic( $token, $exp, $sig ) {
		return $exp > time() && hash_equals( self::magic_sig( $token, $exp ), (string) $sig );
	}
	private static function cookie_name( $project ) {
		return 'yaa_portal_' . (int) $project->id;
	}
	private static function cookie_val( $project ) {
		return hash_hmac( 'sha256', (string) $project->token, self::secret() );
	}
	private static function set_session( $project ) {
		setcookie(
			self::cookie_name( $project ),
			self::cookie_val( $project ),
			array( 'expires' => time() + self::SESSION_DAYS * DAY_IN_SECONDS, 'path' => '/', 'samesite' => 'Lax', 'secure' => is_ssl(), 'httponly' => true )
		);
	}
	private static function has_session( $project ) {
		$name = self::cookie_name( $project );
		return isset( $_COOKIE[ $name ] ) && hash_equals( self::cookie_val( $project ), sanitize_text_field( wp_unslash( $_COOKIE[ $name ] ) ) );
	}

	/** template_redirect: turn a valid magic link into a session cookie, then strip the params. */
	public static function maybe_consume_magic() {
		if ( empty( $_GET['token'] ) || ! isset( $_GET['e'], $_GET['k'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		$token   = sanitize_text_field( wp_unslash( $_GET['token'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		$project = YAA_Project::by_token( $token );
		if ( $project && self::verify_magic( $token, (int) $_GET['e'], sanitize_text_field( wp_unslash( $_GET['k'] ) ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			self::set_session( $project );
		}
		wp_safe_redirect( remove_query_arg( array( 'e', 'k' ) ) );
		exit;
	}

	/** The portal page's base URL (no query args). */
	private static function base_url() {
		$page_id = (int) YAA_Settings::get( 'portal_page_id', 0 );
		return ( $page_id && get_post_status( $page_id ) ) ? get_permalink( $page_id ) : home_url( '/' );
	}

	/** Email the client a fresh one-click sign-in link. */
	public static function send_signin_link( $project ) {
		if ( ! is_email( $project->email ) ) {
			return false;
		}
		$url  = self::magic_url( $project );
		$host = preg_replace( '/^www\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$from = 'noreply@' . ( $host ? $host : 'yourarchitect.uk' );
		$html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px">'
			. '<div style="font-size:20px;font-weight:800;color:#253E94;margin-bottom:18px">Your Architect</div>'
			. '<p style="line-height:1.6;color:#1a2233">Here\'s your secure sign-in link for your project portal. It keeps you signed in on this device for 7 days.</p>'
			. '<p style="margin:22px 0"><a href="' . esc_url( $url ) . '" style="display:inline-block;background:#253E94;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">View my project</a></p>'
			. '<p style="line-height:1.6;color:#6b7488;font-size:13px">If you didn\'t ask for this, you can safely ignore it. For your security the link expires and only works from your email.</p>'
			. '</div>';
		$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', 'Your Architect', $from ) );
		return wp_mail( $project->email, 'Your Architect — your secure sign-in link', $html, $headers );
	}

	/** POST: email me a sign-in link. */
	public static function act_signin() {
		check_admin_referer( 'yaa_portal_signin' );
		$token   = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : '';
		$project = YAA_Project::by_token( $token );
		if ( $project ) {
			self::send_signin_link( $project );
		}
		wp_safe_redirect( add_query_arg( array( 'token' => $token, 'sent' => 1 ), self::base_url() ) );
		exit;
	}

	/** POST: client requests a revision from inside the portal (after unlock). */
	public static function act_revision() {
		check_admin_referer( 'yaa_portal_revision' );
		$token   = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : '';
		$project = YAA_Project::by_token( $token );
		$message = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';
		if ( $project && '' !== $message ) {
			YAA_Project::log_event( $project->id, 'revision_requested', array( 'message' => $message ) );
			self::notify_revision( $project, $message );
		}
		wp_safe_redirect( add_query_arg( array( 'token' => $token, 'revision' => 1 ), self::base_url() ) );
		exit;
	}

	/** Alert the studio (the notify list) that a client asked for a revision. */
	private static function notify_revision( $project, $message ) {
		$to      = class_exists( 'YAA_Followups' ) ? YAA_Followups::studio_recipients() : array( get_option( 'admin_email' ) );
		$host    = preg_replace( '/^www\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$from    = 'noreply@' . ( $host ? $host : 'yourarchitect.uk' );
		$who     = $project->name ? $project->name : ( $project->email ? $project->email : 'A client' );
		$link    = admin_url( 'admin.php?page=' . YAA_Projects_Admin::SLUG . '&project=' . (int) $project->id );
		$subject = 'Revision requested | ' . ( $project->ref ? $project->ref : $who );
		$body    = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
			. '<div style="font-size:19px;font-weight:800;color:#253E94;margin-bottom:14px">Revision requested</div>'
			. '<p style="line-height:1.6;color:#1a2233"><strong>' . esc_html( $who ) . '</strong>' . ( $project->ref ? ' · Ref ' . esc_html( $project->ref ) : '' ) . ' has requested a revision:</p>'
			. '<blockquote style="margin:0 0 16px;padding:12px 16px;background:#f6f8fd;border-left:3px solid #253E94;color:#1a2233;line-height:1.6">' . nl2br( esc_html( $message ) ) . '</blockquote>'
			. '<p><a href="' . esc_url( $link ) . '" style="display:inline-block;background:#253E94;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">Open project in admin</a></p>'
			. '</div>';
		$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', 'Your Architect', $from ) );
		if ( is_email( $project->email ) ) {
			$headers[] = sprintf( 'Reply-To: %s <%s>', $who, $project->email );
		}
		wp_mail( $to, $subject, $body, $headers );
	}


	/** Portal URL for a project (creates the token on first use). */
	public static function url( $project_id ) {
		$token   = YAA_Project::ensure_token( $project_id );
		$page_id = (int) YAA_Settings::get( 'portal_page_id', 0 );
		$base    = ( $page_id && get_post_status( $page_id ) ) ? get_permalink( $page_id ) : home_url( '/' );
		return add_query_arg( 'token', $token, $base );
	}

	private static function styles() {
		wp_register_style( 'yaa-fonts', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap', array(), null );
		wp_enqueue_style( 'yaa-fonts' );
		wp_register_style( 'yaa-portal', YAA_URL . 'assets/css/portal.css', array( 'yaa-fonts' ), YAA_VERSION );
		wp_enqueue_style( 'yaa-portal' );
	}

	private static function assets( $project ) {
		self::styles();
		if ( ! $project->paid && YAA_Stripe::is_configured() && (int) $project->total > 0 ) {
			wp_register_script( 'stripe-js', 'https://js.stripe.com/v3/', array(), null, true );
			wp_register_script( 'yaa-portal', YAA_URL . 'assets/js/portal.js', array( 'stripe-js' ), YAA_VERSION, true );
			wp_localize_script( 'yaa-portal', 'yaaPortal', array(
				'rest'     => esc_url_raw( rest_url( 'yaa/v1/' ) ),
				'token'    => $project->token,
				'returnUrl' => self::url( $project->id ),
			) );
			wp_enqueue_script( 'yaa-portal' );
		}
	}

	public static function render() {
		$token   = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$project = $token ? YAA_Project::by_token( $token ) : null;
		if ( ! $project ) {
			return '<div class="yaa-portal"><div class="yp-card"><h2>Project not found</h2><p>This link doesn\'t match a project. Please use the link from your email, or contact us.</p></div></div>';
		}

		// Gate: the studio (logged in) always sees it; everyone else needs the 7-day
		// trusted-browser session from a one-click sign-in link.
		if ( ! current_user_can( 'manage_options' ) && ! self::has_session( $project ) ) {
			return self::signin_screen( $project );
		}

		self::assets( $project );

		$state   = json_decode( (string) $project->state_json, true );
		$state   = is_array( $state ) ? $state : array();
		$package = json_decode( (string) $project->package_json, true );
		$package = is_array( $package ) ? $package : array( 'nodes' => array() );
		$first   = $project->name ? strtok( $project->name, ' ' ) : 'there';
		$paid    = (bool) $project->paid;

		ob_start();
		?>
		<div class="yaa-portal">
			<header class="yp-head" style="justify-content:flex-end">
				<div class="yp-ref"><?php echo $project->ref ? 'Ref ' . esc_html( $project->ref ) : ''; ?></div>
			</header>

			<div class="yp-hero yp-card">
				<h1><?php echo esc_html( 'Hi ' . $first . ' — your project' ); ?></h1>
				<p class="yp-status <?php echo $paid ? 'paid' : ''; ?>"><?php echo $paid ? esc_html__( 'Paid — in progress', 'your-architect-archie' ) : esc_html__( 'Ready for payment', 'your-architect-archie' ); ?></p>
			</div>

			<div class="yp-grid">
				<section class="yp-card">
					<h2><?php esc_html_e( 'Your confirmed project', 'your-architect-archie' ); ?></h2>
					<dl class="yp-summary">
						<?php foreach ( YAA_Archie::answer_summary( $state ) as $q ) : ?>
							<?php if ( $q['answered'] ) : ?>
								<div><dt><?php echo esc_html( $q['label'] ); ?></dt><dd><?php echo esc_html( $q['value'] ); ?></dd></div>
							<?php endif; ?>
						<?php endforeach; ?>
					</dl>
					<div class="yp-nodes">
						<?php foreach ( $package['nodes'] as $n ) : ?>
							<?php if ( ! isset( $n['kind'] ) || 'info' !== $n['kind'] ) : ?>
								<div class="yp-node"><span><?php echo esc_html( isset( $n['label'] ) ? $n['label'] : '' ); ?></span><span><?php echo isset( $n['price'] ) && null !== $n['price'] ? esc_html( YAA_Pricing::money( (int) $n['price'] ) ) : esc_html__( 'quote to follow', 'your-architect-archie' ); ?></span></div>
							<?php endif; ?>
						<?php endforeach; ?>
						<div class="yp-node total"><span><?php esc_html_e( 'Total', 'your-architect-archie' ); ?></span><span><?php echo esc_html( YAA_Pricing::money( (int) $project->total ) ); ?></span></div>
					</div>
				</section>

				<aside class="yp-card yp-pay">
					<?php if ( $paid ) : ?>
						<h2><?php esc_html_e( 'Payment', 'your-architect-archie' ); ?></h2>
						<div class="yp-receipt">
							<div class="yp-tick">✓</div>
							<p><strong><?php echo esc_html( YAA_Pricing::money( (int) round( $project->amount_paid / 100 ) ) ); ?></strong> <?php esc_html_e( 'paid', 'your-architect-archie' ); ?><?php echo $project->paid_at ? ' · ' . esc_html( date_i18n( 'j M Y', strtotime( $project->paid_at ) ) ) : ''; ?></p>
							<p class="yp-sub"><?php esc_html_e( 'Thank you. Your drawings are unlocked below as we add them.', 'your-architect-archie' ); ?></p>
						</div>
					<?php elseif ( YAA_Stripe::is_configured() && (int) $project->total > 0 ) : ?>
						<h2><?php esc_html_e( 'Secure payment', 'your-architect-archie' ); ?></h2>
						<p class="yp-sub"><?php esc_html_e( 'Pay your fixed price to start your drawings.', 'your-architect-archie' ); ?></p>
						<div id="yaa-pay-element"></div>
						<button id="yaa-pay-btn" class="yp-btn"><?php echo esc_html( sprintf( __( 'Pay %s', 'your-architect-archie' ), YAA_Pricing::money( (int) $project->total ) ) ); ?></button>
						<div id="yaa-pay-msg" class="yp-pay-msg" role="alert"></div>
						<p class="yp-lock">🔒 <?php esc_html_e( 'Payments are processed securely by Stripe.', 'your-architect-archie' ); ?></p>
					<?php else : ?>
						<h2><?php esc_html_e( 'Payment', 'your-architect-archie' ); ?></h2>
						<p class="yp-sub"><?php esc_html_e( 'We\'ll be in touch shortly with your secure payment link.', 'your-architect-archie' ); ?></p>
					<?php endif; ?>
				</aside>
			</div>

			<?php echo self::files_section( $project, 'client', __( 'What you uploaded', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<?php echo self::files_section( $project, 'drawing', __( 'Your drawings', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<?php echo self::files_section( $project, 'doc', __( 'Documents', 'your-architect-archie' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

			<?php if ( $paid ) : ?>
				<section class="yp-card">
					<h2><?php esc_html_e( 'Need a change?', 'your-architect-archie' ); ?></h2>
					<?php if ( isset( $_GET['revision'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
						<p class="yp-note-ok"><?php esc_html_e( 'Thanks — we\'ve passed your revision request to the team and they\'ll be in touch.', 'your-architect-archie' ); ?></p>
					<?php else : ?>
						<p class="yp-sub"><?php echo esc_html( sprintf( __( 'Your package includes %d revisions. Tell us what you\'d like changed and we\'ll take a look.', 'your-architect-archie' ), (int) ( isset( $package['meta']['revisions'] ) ? $package['meta']['revisions'] : 2 ) ) ); ?></p>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="yp-revision">
							<input type="hidden" name="action" value="yaa_portal_revision">
							<input type="hidden" name="token" value="<?php echo esc_attr( $project->token ); ?>">
							<?php wp_nonce_field( 'yaa_portal_revision' ); ?>
							<textarea name="message" rows="4" required placeholder="<?php esc_attr_e( 'What would you like us to change?', 'your-architect-archie' ); ?>"></textarea>
							<button type="submit" class="yp-btn"><?php esc_html_e( 'Request a revision', 'your-architect-archie' ); ?></button>
						</form>
					<?php endif; ?>
				</section>
			<?php endif; ?>

			<p class="yp-copyright"><?php esc_html_e( '© Tiam Architects LLP. All drawings and documents are the copyright of Tiam Architects LLP (trading as Your Architect) and are provided for this project only. They may not be copied, shared, submitted or used for construction until payment has been made in full. Unauthorised use may result in legal action.', 'your-architect-archie' ); ?></p>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Sign-in screen shown when there's no trusted-browser session: offers to email
	 * a one-click sign-in link to the (masked) address held on the project.
	 */
	private static function signin_screen( $project ) {
		self::styles();
		$sent   = isset( $_GET['sent'] ); // phpcs:ignore WordPress.Security.NonceVerification
		$masked = self::mask_email( (string) $project->email );
		ob_start();
		?>
		<div class="yaa-portal">
			<div class="yp-card yp-signin">
				<h2><?php esc_html_e( 'View your project', 'your-architect-archie' ); ?></h2>
				<?php if ( ! is_email( $project->email ) ) : ?>
					<p><?php esc_html_e( 'We don\'t have an email address on file for this project yet — please contact us and we\'ll help you in.', 'your-architect-archie' ); ?></p>
				<?php elseif ( $sent ) : ?>
					<p class="yp-note-ok"><?php echo esc_html( sprintf( __( 'Done — we\'ve emailed a secure sign-in link to %s. Open it on this device and you\'ll stay signed in for 7 days.', 'your-architect-archie' ), $masked ) ); ?></p>
				<?php else : ?>
					<p class="yp-sub"><?php echo esc_html( sprintf( __( 'For your security, we\'ll email a one-click sign-in link to the address on your project (%s). It keeps you signed in on this device for 7 days.', 'your-architect-archie' ), $masked ) ); ?></p>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="yaa_portal_signin">
						<input type="hidden" name="token" value="<?php echo esc_attr( $project->token ); ?>">
						<?php wp_nonce_field( 'yaa_portal_signin' ); ?>
						<button type="submit" class="yp-btn"><?php esc_html_e( 'Email me a sign-in link', 'your-architect-archie' ); ?></button>
					</form>
				<?php endif; ?>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/** j••@e••.com — enough to recognise, not enough to reveal. */
	private static function mask_email( $email ) {
		if ( ! is_email( $email ) ) {
			return '';
		}
		list( $u, $d ) = explode( '@', $email, 2 );
		$mu = mb_substr( $u, 0, 1 ) . str_repeat( '•', max( 1, mb_strlen( $u ) - 1 ) );
		$md = mb_substr( $d, 0, 1 ) . str_repeat( '•', 1 ) . ( false !== strrpos( $d, '.' ) ? substr( $d, strrpos( $d, '.' ) ) : '' );
		return $mu . '@' . $md;
	}

	/** Render a file group; drawings stay locked (blurred) until paid. */
	private static function files_section( $project, $kind, $title ) {
		if ( ! class_exists( 'YAA_Files' ) ) {
			return '';
		}
		$files = YAA_Files::for_project( $project->id, $kind );
		if ( empty( $files ) ) {
			return '';
		}
		$paid = (bool) $project->paid;
		ob_start();
		?>
		<section class="yp-card">
			<h2><?php echo esc_html( $title ); ?></h2>
			<div class="yp-files">
				<?php foreach ( $files as $f ) : ?>
					<?php
					$locked = ( 'drawing' === $kind && ! $paid && $f->gated );
					$is_img = ( 0 === strpos( (string) $f->mime, 'image/' ) );
					?>
					<div class="yp-file <?php echo $locked ? 'locked' : ''; ?>">
						<?php if ( $locked && $is_img ) : ?>
							<div class="yp-thumb"><img src="<?php echo esc_url( YAA_Files::preview_url( $f ) ); ?>" alt=""><span class="yp-lockbadge">🔒 <?php esc_html_e( 'Pay to unlock', 'your-architect-archie' ); ?></span></div>
						<?php elseif ( $locked ) : ?>
							<div class="yp-thumb yp-thumb-doc"><span class="yp-lockbadge">🔒 <?php esc_html_e( 'Pay to unlock', 'your-architect-archie' ); ?></span></div>
						<?php else : ?>
							<a class="yp-thumb" href="<?php echo esc_url( YAA_Files::download_url( $f, $project->token ) ); ?>" target="_blank" rel="noopener">
								<?php if ( $is_img ) : ?><img src="<?php echo esc_url( YAA_Files::download_url( $f, $project->token ) ); ?>" alt=""><?php else : ?><span class="yp-doc-ico">PDF</span><?php endif; ?>
							</a>
						<?php endif; ?>
						<div class="yp-file-meta">
							<span class="yp-file-label"><?php echo esc_html( YAA_Files::filename( $f ) ); ?></span>
							<?php if ( $f->source ) : ?><span class="yp-file-src"><?php echo esc_html( $f->source ); ?></span><?php endif; ?>
						</div>
					</div>
				<?php endforeach; ?>
			</div>
			<?php if ( 'drawing' === $kind && ! $paid ) : ?>
				<p class="yp-sub"><?php esc_html_e( 'Your drawings are shown as blurred previews until payment clears — then the full-resolution files unlock here automatically.', 'your-architect-archie' ); ?></p>
			<?php endif; ?>
		</section>
		<?php
		return ob_get_clean();
	}
}

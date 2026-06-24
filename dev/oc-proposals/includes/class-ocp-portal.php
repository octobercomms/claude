<?php
/**
 * Public client portal. A proposal is read, signed and (later) paid on a
 * standalone, on-brand page reached via the unguessable token in ?ocp_proposal.
 * The page renders its own full HTML document (it does not use the theme).
 *
 * The token is the only credential. Accepting requires agreeing to the snapshot
 * Terms + a signature; we record an audit trail and email a record to the client
 * and the studio. The signed PDF is attached once the PDF build (PR5) lands.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Portal {

	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
		add_action( 'admin_post_nopriv_ocp_accept', array( __CLASS__, 'handle_accept' ) );
		add_action( 'admin_post_ocp_accept', array( __CLASS__, 'handle_accept' ) );
		add_action( 'wp_ajax_nopriv_ocp_event', array( __CLASS__, 'handle_event' ) );
		add_action( 'wp_ajax_ocp_event', array( __CLASS__, 'handle_event' ) );
	}

	public static function query_vars( $vars ) {
		$vars[] = 'ocp_proposal';
		return $vars;
	}

	private static function token() {
		$t = get_query_var( 'ocp_proposal' );
		if ( '' === $t && isset( $_GET['ocp_proposal'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$t = wp_unslash( $_GET['ocp_proposal'] ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		return preg_replace( '/[^A-Za-z0-9]/', '', (string) $t );
	}

	public static function maybe_render() {
		$token = self::token();
		if ( '' === $token ) {
			return;
		}
		$p = OCP_Proposal::get_by_token( $token );
		if ( ! $p ) {
			status_header( 404 );
			wp_die( esc_html__( 'Proposal not found.', 'oc-proposals' ) );
		}

		// View tracking (first view flips sent → viewed).
		OCP_Proposal::mark_viewed( $p['id'] );
		self::log_event( $p['id'], 'view', '', '' );

		nocache_headers();
		header( 'X-Robots-Tag: noindex, nofollow', true );
		echo self::document( $p ); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}

	/** The full standalone HTML document. */
	private static function document( array $p ) {
		$accepted = ( 'accepted' === $p['status'] );
		$body     = OCP_Render::body( $p, 'web' );
		$clarity  = OCP_Settings::get( 'clarity_id' );

		ob_start();
		?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title><?php echo esc_html( $p['client_name'] . ' — ' . get_bloginfo( 'name' ) ); ?></title>
<link rel="stylesheet" href="<?php echo esc_url( OCP_URL . 'assets/css/portal.css?v=' . OCP_VERSION ); ?>" />
<style><?php echo OCP_Settings::css_root(); // phpcs:ignore WordPress.Security.EscapeOutput ?></style>
<?php if ( $clarity ) : ?>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","<?php echo esc_js( $clarity ); ?>");</script>
<?php endif; ?>
</head>
<body class="ocp-portal">
<main class="ocp-doc">
<?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput ?>
<?php echo self::accept_block( $p, $accepted ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
</main>
<script src="<?php echo esc_url( OCP_URL . 'assets/js/portal.js?v=' . OCP_VERSION ); ?>"
	data-ajax="<?php echo esc_url( admin_url( 'admin-ajax.php' ) ); ?>"
	data-token="<?php echo esc_attr( $p['token'] ); ?>"></script>
</body>
</html>
		<?php
		return ob_get_clean();
	}

	/** Terms + accept/sign form, or a confirmation once accepted. */
	private static function accept_block( array $p, $accepted ) {
		if ( $accepted ) {
			return '<section class="ocp-sec ocp-accepted"><div class="ocp-eyebrow">' . esc_html__( 'Accepted', 'oc-proposals' ) . '</div>'
				. '<p>' . esc_html__( 'Thank you — this proposal has been accepted and a signed copy emailed to you. We’ll be in touch to begin.', 'oc-proposals' ) . '</p></section>';
		}

		$terms = OCP_Terms::current();
		$post  = admin_url( 'admin-post.php' );

		$html  = '<section class="ocp-sec ocp-next" data-sec="next_step"><div class="ocp-eyebrow">' . esc_html__( 'Next step', 'oc-proposals' ) . '</div>';
		$html .= '<h2>' . esc_html__( 'Ready to start?', 'oc-proposals' ) . '</h2>';
		$html .= '<p>' . esc_html__( 'Accept and sign below and we’ll book your kickoff. Questions first? Reply to the email and we’ll jump on a call.', 'oc-proposals' ) . '</p>';

		if ( $terms && trim( (string) $terms['body'] ) !== '' ) {
			$html .= '<details class="ocp-terms"><summary>' . esc_html__( 'Terms & Conditions', 'oc-proposals' ) . '</summary><div class="ocp-terms-body">'
				. wp_kses_post( wpautop( $terms['body'] ) ) . '</div></details>';
		}

		$html .= '<form class="ocp-accept" method="post" action="' . esc_url( $post ) . '">';
		$html .= '<input type="hidden" name="action" value="ocp_accept" />';
		$html .= '<input type="hidden" name="token" value="' . esc_attr( $p['token'] ) . '" />';
		$html .= wp_nonce_field( 'ocp_accept_' . $p['token'], '_ocp_nonce', true, false );
		$html .= '<label class="ocp-field"><span>' . esc_html__( 'Your full name (signature)', 'oc-proposals' ) . '</span><input type="text" name="signature_name" required /></label>';
		$html .= '<label class="ocp-field"><span>' . esc_html__( 'Your email', 'oc-proposals' ) . '</span><input type="email" name="signatory_email" required /></label>';
		$html .= '<label class="ocp-check"><input type="checkbox" name="agree" value="1" required /> ' . esc_html__( 'I agree to the Terms & Conditions.', 'oc-proposals' ) . '</label>';
		$html .= '<button type="submit" class="ocp-btn">' . esc_html__( 'Accept & sign', 'oc-proposals' ) . '</button>';
		$html .= '</form></section>';
		return $html;
	}

	// --- Accept / sign -------------------------------------------------------

	public static function handle_accept() {
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) ( $_POST['token'] ?? '' ) );
		$p     = OCP_Proposal::get_by_token( $token );
		if ( ! $p ) {
			wp_die( esc_html__( 'Proposal not found.', 'oc-proposals' ) );
		}
		if ( ! wp_verify_nonce( $_POST['_ocp_nonce'] ?? '', 'ocp_accept_' . $token ) ) {
			wp_die( esc_html__( 'Security check failed. Please reload and try again.', 'oc-proposals' ) );
		}
		if ( empty( $_POST['agree'] ) ) {
			wp_die( esc_html__( 'You must agree to the Terms to proceed.', 'oc-proposals' ) );
		}

		$name  = sanitize_text_field( wp_unslash( $_POST['signature_name'] ?? '' ) );
		$email = sanitize_email( wp_unslash( $_POST['signatory_email'] ?? '' ) );
		if ( '' === $name || ! is_email( $email ) ) {
			wp_die( esc_html__( 'Please provide your name and a valid email.', 'oc-proposals' ) );
		}

		$terms = OCP_Terms::current();
		$hash  = hash( 'sha256', $token . '|' . $name . '|' . $email . '|' . ( $terms['version'] ?? '0' ) . '|' . wp_json_encode( OCP_Proposal::items( $p['id'] ) ) );

		OCP_Repo::insert( OCP_DB::acceptances_table(), array(
			'proposal_id'      => (int) $p['id'],
			'terms_version_id' => $terms ? (int) $terms['id'] : null,
			'signatory_name'   => $name,
			'signatory_email'  => $email,
			'signed_at'        => current_time( 'mysql' ),
			'ip'               => self::client_ip(),
			'user_agent'       => substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ?? '' ) ), 0, 255 ),
			'document_hash'    => $hash,
		) );

		OCP_Proposal::mark_accepted( $p['id'] );
		self::log_event( $p['id'], 'accept', '', $email );

		// Move the linked CRM lead to Closed won, if any.
		if ( ! empty( $p['lead_id'] ) ) {
			OCP_Lead::save( array( 'status' => 'closed_won' ), (int) $p['lead_id'] );
		}

		self::email_record( $p, $name, $email, $hash );

		wp_safe_redirect( OCP_Proposal::url( $token ) );
		exit;
	}

	/** Email the signed record to the client and the studio (PDF attached in PR5). */
	private static function email_record( array $p, $name, $email, $hash ) {
		$studio  = OCP_Settings::get( 'company_email', get_option( 'admin_email' ) );
		$subject = sprintf( __( 'Proposal accepted — %s', 'oc-proposals' ), $p['client_name'] );
		$lines   = array(
			sprintf( __( '%s accepted the proposal.', 'oc-proposals' ), $name ),
			'',
			__( 'Signatory:', 'oc-proposals' ) . ' ' . $name . ' <' . $email . '>',
			__( 'When:', 'oc-proposals' ) . ' ' . current_time( 'mysql' ),
			__( 'Reference:', 'oc-proposals' ) . ' ' . substr( $hash, 0, 16 ),
			'',
			__( 'View:', 'oc-proposals' ) . ' ' . OCP_Proposal::url( $p['token'] ),
		);
		$body = implode( "\n", $lines );
		wp_mail( $email, $subject, $body );
		if ( $studio && $studio !== $email ) {
			wp_mail( $studio, $subject, $body );
		}
	}

	// --- Engagement events (first-party) -------------------------------------

	public static function handle_event() {
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) ( $_POST['token'] ?? '' ) );
		$p     = OCP_Proposal::get_by_token( $token );
		if ( ! $p ) {
			wp_send_json_error();
		}
		$event   = sanitize_key( wp_unslash( $_POST['event'] ?? '' ) );
		$section = sanitize_key( wp_unslash( $_POST['section'] ?? '' ) );
		$value   = sanitize_text_field( wp_unslash( $_POST['value'] ?? '' ) );
		if ( $event ) {
			self::log_event( $p['id'], $event, $section, $value );
		}
		wp_send_json_success();
	}

	private static function log_event( $proposal_id, $event, $section, $value ) {
		OCP_Repo::insert( OCP_DB::events_table(), array(
			'proposal_id' => (int) $proposal_id,
			'event'       => substr( $event, 0, 40 ),
			'section_key' => substr( $section, 0, 40 ),
			'value'       => substr( (string) $value, 0, 255 ),
			'session_id'  => substr( md5( ( $_SERVER['REMOTE_ADDR'] ?? '' ) . ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) . gmdate( 'Ymd' ) ), 0, 32 ),
		) );
	}

	private static function client_ip() {
		$ip = $_SERVER['REMOTE_ADDR'] ?? '';
		return substr( sanitize_text_field( wp_unslash( $ip ) ), 0, 64 );
	}
}

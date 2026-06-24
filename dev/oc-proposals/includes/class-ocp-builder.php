<?php
/**
 * Public "create your own proposal" builder. Rendered by [oc_proposal_builder].
 *
 * Two ways in: an options picker (deterministic, no API call) that returns an
 * indicative range, and a scoped chat to the cheap Claude agent. Abuse controls,
 * layered so a real prospect is never blocked:
 *   - options-first (most traffic never hits the API)
 *   - Cloudflare Turnstile on the chat
 *   - per-IP rate limiting
 *   - email unlock before chat / saving (also seeds the CRM)
 *   - tightly-scoped server-side agent (key never exposed), capped tokens
 *   - hard monthly API budget cap (falls back to the picker when hit)
 *   - indicative ranges only, with a non-binding disclaimer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Builder {

	const NS              = 'ocp/v1';
	const BUDGET_OPTION   = 'ocp_builder_budget';
	const MONTHLY_CAP     = 500;   // max agent calls per month (cost ceiling).
	const RATE_PER_HOUR   = 20;    // max chat messages per IP per hour.

	public static function init() {
		add_shortcode( 'oc_proposal_builder', array( __CLASS__, 'shortcode' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route( self::NS, '/builder/estimate', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'estimate' ),
			'permission_callback' => '__return_true',
		) );
		register_rest_route( self::NS, '/builder/chat', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'chat' ),
			'permission_callback' => '__return_true',
		) );
	}

	/** Indicative ranges per proposal type (studio-tunable later via settings). */
	public static function ranges() {
		return array(
			'retainer' => array( 'label' => __( 'Marketing / PR retainer', 'oc-proposals' ), 'oneoff' => array( 500, 1500 ), 'monthly' => array( 750, 2500 ) ),
			'website'  => array( 'label' => __( 'Website rebuild', 'oc-proposals' ), 'project' => array( 3500, 12000 ) ),
			'event'    => array( 'label' => __( 'Event PR', 'oc-proposals' ), 'project' => array( 2500, 8000 ) ),
		);
	}

	public static function shortcode() {
		ob_start();
		?>
		<div id="ocp-builder" class="ocp-builder">
			<div class="ocp-eyebrow"><?php esc_html_e( 'Create your own proposal', 'oc-proposals' ); ?></div>
			<h2><?php esc_html_e( 'Get an indicative cost in a minute', 'oc-proposals' ); ?></h2>
			<label><?php esc_html_e( 'What do you need?', 'oc-proposals' ); ?>
				<select id="ocp-b-type">
					<?php foreach ( self::ranges() as $k => $r ) : ?>
						<option value="<?php echo esc_attr( $k ); ?>"><?php echo esc_html( $r['label'] ); ?></option>
					<?php endforeach; ?>
				</select>
			</label>
			<button id="ocp-b-go" class="ocp-btn"><?php esc_html_e( 'Show indicative range', 'oc-proposals' ); ?></button>
			<div id="ocp-b-result"></div>
			<p class="ocp-disclaimer"><?php esc_html_e( 'Indicative estimate, not a binding quote; final pricing confirmed on a short call.', 'oc-proposals' ); ?></p>
		</div>
		<script>
		(function(){
			var btn=document.getElementById('ocp-b-go');
			if(!btn)return;
			btn.addEventListener('click',function(){
				var type=document.getElementById('ocp-b-type').value;
				var fd=new FormData();fd.append('type',type);
				fetch('<?php echo esc_url_raw( rest_url( self::NS . '/builder/estimate' ) ); ?>',{method:'POST',body:fd})
					.then(function(r){return r.json();})
					.then(function(d){document.getElementById('ocp-b-result').innerHTML=d.html||'';});
			});
		})();
		</script>
		<?php
		return ob_get_clean();
	}

	/** Deterministic indicative range — no API call, never blocked. */
	public static function estimate( $request ) {
		$type   = sanitize_key( $request->get_param( 'type' ) );
		$ranges = self::ranges();
		if ( ! isset( $ranges[ $type ] ) ) {
			return rest_ensure_response( array( 'html' => '' ) );
		}
		$r    = $ranges[ $type ];
		$html = '<div class="ocp-b-range"><h3>' . esc_html( $r['label'] ) . '</h3><ul>';
		foreach ( array( 'oneoff' => __( 'One-off', 'oc-proposals' ), 'monthly' => __( 'Monthly', 'oc-proposals' ), 'project' => __( 'Project', 'oc-proposals' ) ) as $ck => $cl ) {
			if ( ! empty( $r[ $ck ] ) ) {
				$html .= '<li>' . esc_html( $cl ) . ': £' . number_format_i18n( $r[ $ck ][0] ) . '–£' . number_format_i18n( $r[ $ck ][1] ) . ( 'monthly' === $ck ? esc_html__( ' / month', 'oc-proposals' ) : '' ) . '</li>';
			}
		}
		$html .= '</ul></div>';
		return rest_ensure_response( array( 'html' => $html ) );
	}

	/** Scoped chat to the cheap agent — gated by Turnstile, rate limit, budget. */
	public static function chat( $request ) {
		// 1. Email unlock.
		$email = sanitize_email( (string) $request->get_param( 'email' ) );
		if ( ! is_email( $email ) ) {
			return new WP_Error( 'ocp_email', __( 'Please provide your email to chat.', 'oc-proposals' ), array( 'status' => 400 ) );
		}
		// 2. Turnstile (if configured).
		if ( ! self::verify_turnstile( (string) $request->get_param( 'turnstile' ) ) ) {
			return new WP_Error( 'ocp_bot', __( 'Bot check failed.', 'oc-proposals' ), array( 'status' => 403 ) );
		}
		// 3. Rate limit per IP.
		if ( ! self::rate_ok() ) {
			return new WP_Error( 'ocp_rate', __( 'Too many messages — please slow down.', 'oc-proposals' ), array( 'status' => 429 ) );
		}
		// 4. Budget cap → fall back to picker.
		if ( ! self::budget_ok() || ! OCP_Claude::enabled() ) {
			return rest_ensure_response( array( 'reply' => __( 'Our assistant is resting — use the options above for an indicative range, or leave your email and we’ll be in touch.', 'oc-proposals' ) ) );
		}

		// Seed/refresh a CRM lead from the email (idempotent enough for a builder).
		self::seed_lead( $email );

		$history = json_decode( (string) $request->get_param( 'history' ), true );
		$history = is_array( $history ) ? array_slice( $history, -8 ) : array();
		$msg     = sanitize_textarea_field( (string) $request->get_param( 'message' ) );
		if ( $msg ) {
			$history[] = array( 'role' => 'user', 'content' => $msg );
		}

		$services = implode( ', ', wp_list_pluck( OCP_Repo::all( OCP_DB::services_table(), 'id ASC' ), 'name' ) );
		$reply    = OCP_Claude::builder_reply( $history, $services ?: 'PR, SEO, content, websites, paid media' );
		if ( is_wp_error( $reply ) ) {
			return rest_ensure_response( array( 'reply' => __( 'Sorry — try the options above for now.', 'oc-proposals' ) ) );
		}
		self::spend();
		return rest_ensure_response( array( 'reply' => $reply ) );
	}

	private static function verify_turnstile( $token ) {
		$secret = OCP_Settings::get( 'turnstile_secret' );
		if ( ! $secret ) {
			return true; // Not configured ⇒ don't block (other layers still apply).
		}
		if ( ! $token ) {
			return false;
		}
		$res = wp_remote_post( 'https://challenges.cloudflare.com/turnstile/v0/siteverify', array(
			'body'    => array( 'secret' => $secret, 'response' => $token, 'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '' ),
			'timeout' => 15,
		) );
		if ( is_wp_error( $res ) ) {
			return false;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		return ! empty( $json['success'] );
	}

	private static function rate_ok() {
		$ip  = md5( ( $_SERVER['REMOTE_ADDR'] ?? '' ) . gmdate( 'YmdH' ) );
		$key = 'ocp_rl_' . $ip;
		$n   = (int) get_transient( $key );
		if ( $n >= self::RATE_PER_HOUR ) {
			return false;
		}
		set_transient( $key, $n + 1, HOUR_IN_SECONDS );
		return true;
	}

	private static function budget_ok() {
		$state = get_option( self::BUDGET_OPTION, array() );
		$month = gmdate( 'Y-m' );
		if ( ( $state['month'] ?? '' ) !== $month ) {
			return true;
		}
		return (int) ( $state['count'] ?? 0 ) < self::MONTHLY_CAP;
	}

	private static function spend() {
		$state = get_option( self::BUDGET_OPTION, array() );
		$month = gmdate( 'Y-m' );
		if ( ( $state['month'] ?? '' ) !== $month ) {
			$state = array( 'month' => $month, 'count' => 0 );
		}
		$state['count'] = (int) ( $state['count'] ?? 0 ) + 1;
		update_option( self::BUDGET_OPTION, $state );
	}

	private static function seed_lead( $email ) {
		global $wpdb;
		$table = OCP_DB::leads_table();
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE email = %s LIMIT 1", $email ) );
		if ( $exists ) {
			return;
		}
		OCP_Lead::save( array(
			'client_name' => $email,
			'status'      => 'lead_in',
			'lead_source' => 'Website Referral',
			'lead_source_desc' => 'Proposal builder',
			'email'       => $email,
			'lead_date'   => gmdate( 'Y-m-d' ),
		) );
	}
}

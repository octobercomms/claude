<?php
/**
 * Public client portal for proposals.
 *
 * A proposal is reviewed and paid on a standalone, on-brand page reached via an
 * unguessable token in the `hgd_proposal` query var. The page renders its own full
 * HTML document (it does not use the theme) so it looks like a hosted checkout.
 *
 * REST routes (namespace hgd/v1, distinct from the booking routes):
 *   - POST /proposal/accept   token + signature_name → sign + accept
 *   - POST /proposal/pay      token + payment_id      → Stripe PaymentIntent
 *
 * The token is the only credential (the client is logged out); every action
 * re-validates the token and re-derives the amount server-side. Payment fulfilment
 * happens in the existing Stripe webhook (HGD_Booking_Page) via metadata.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Proposal_Portal {

	const NS = 'hgd/v1';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_query_var_rewrite' ) );
		add_filter( 'query_vars', array( __CLASS__, 'register_query_var' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function add_query_var_rewrite() {
		// No rewrite rule needed — we read ?hgd_proposal=… directly. Registering the
		// query var is enough for get_query_var() to work.
	}

	public static function register_query_var( $vars ) {
		$vars[] = 'hgd_proposal';
		return $vars;
	}

	private static function current_token() {
		$token = get_query_var( 'hgd_proposal' );
		if ( '' === $token && isset( $_GET['hgd_proposal'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$token = wp_unslash( $_GET['hgd_proposal'] ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		return preg_replace( '/[^A-Za-z0-9]/', '', (string) $token );
	}

	// -------------------------------------------------------------------------
	// Standalone portal page
	// -------------------------------------------------------------------------

	public static function maybe_render() {
		$token = self::current_token();
		if ( '' === $token ) {
			return;
		}

		$proposal = HGD_Proposal::get_by_token( $token );

		nocache_headers();
		header( 'Content-Type: text/html; charset=utf-8' );

		if ( ! $proposal || 'draft' === $proposal['status'] || HGD_Proposal::is_expired( $proposal ) ) {
			status_header( $proposal ? 410 : 404 );
			self::render_unavailable();
			exit;
		}

		// First view by the client promotes sent → viewed.
		HGD_Proposal::mark_viewed( (int) $proposal['id'] );
		$proposal = HGD_Proposal::get( (int) $proposal['id'] );

		self::render_portal( $proposal );
		exit;
	}

	/** A polite "no longer available" page. */
	private static function render_unavailable() {
		$head = self::doc_head( __( 'Proposal unavailable', 'hillcroft-garden-designer' ) );
		echo $head; // phpcs:ignore WordPress.Security.EscapeOutput
		?>
		<main class="hgd-portal-wrap">
			<div class="hgd-portal-card hgd-portal-center">
				<div class="hgd-portal-mark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>
				<h1><?php esc_html_e( 'This proposal link is no longer available', 'hillcroft-garden-designer' ); ?></h1>
				<p class="hgd-portal-muted"><?php esc_html_e( 'The link may have expired or been superseded. Please get in touch and we’ll send you an up-to-date proposal.', 'hillcroft-garden-designer' ); ?></p>
			</div>
		</main>
		</body></html>
		<?php
	}

	/** Build a client-friendly cost breakdown from the quote (no margin/cost). */
	private static function client_breakdown( $quote_id ) {
		$t = HGD_Quote::compute( $quote_id );
		// Fold materials + wastage into a single "Planting & materials" line so the
		// client never sees internal wastage/contingency mechanics by name.
		$planting   = round( (float) $t['materials_subtotal'] + (float) $t['wastage'] + (float) $t['contingency'], 2 );
		return array(
			'planting'   => $planting,
			'labour'     => round( (float) $t['labour'], 2 ),
			'design_fee' => round( (float) $t['design_fee'], 2 ),
			'subtotal'   => round( (float) $t['subtotal'], 2 ),
			'vat'        => round( (float) $t['vat'], 2 ),
			'total'      => round( (float) $t['total'], 2 ),
		);
	}

	private static function render_portal( array $proposal ) {
		$project = HGD_Project::get( (int) $proposal['project_id'] );
		$client  = ( $project && ! empty( $project['client_id'] ) ) ? HGD_Client::get( (int) $project['client_id'] ) : null;
		$title   = $project ? (string) $project['title'] : __( 'Your garden proposal', 'hillcroft-garden-designer' );

		$breakdown = self::client_breakdown( (int) $proposal['quote_id'] );
		$payments  = HGD_Payment::for_proposal( (int) $proposal['id'] );
		$deposit   = HGD_Payment::deposit_for_proposal( (int) $proposal['id'] );

		$renders = $project ? HGD_Project_Asset::for_project( (int) $project['id'], 'render' ) : array();

		$is_accepted = in_array( $proposal['status'], array( 'accepted', 'deposit_paid', 'complete' ), true );
		$deposit_paid = $deposit ? ( 'paid' === $deposit['status'] ) : false;

		$s          = HGD_Settings::all();
		$configured = HGD_Stripe::is_configured() && '' !== (string) $s['stripe_pub_key'];

		$money = function ( $n ) { return '£' . number_format( (float) $n, 2 ); };

		echo self::doc_head( $title ); // phpcs:ignore WordPress.Security.EscapeOutput
		?>
		<main class="hgd-portal-wrap">
			<header class="hgd-portal-head">
				<div class="hgd-portal-mark"><?php esc_html_e( 'Hillcroft Gardens', 'hillcroft-garden-designer' ); ?></div>
				<span class="hgd-portal-badge"><?php echo esc_html( HGD_Proposal::status_label( $proposal['status'] ) ); ?></span>
			</header>

			<div class="hgd-portal-card">
				<h1><?php echo esc_html( $title ); ?></h1>
				<?php if ( $client ) : ?>
					<p class="hgd-portal-muted"><?php echo esc_html( sprintf( __( 'Prepared for %s', 'hillcroft-garden-designer' ), HGD_Client::full_name( $client ) ) ); ?></p>
				<?php endif; ?>

				<?php if ( '' !== trim( (string) $proposal['intro_text'] ) ) : ?>
					<div class="hgd-portal-intro"><?php echo wp_kses_post( wpautop( $proposal['intro_text'] ) ); ?></div>
				<?php endif; ?>
			</div>

			<?php if ( ! empty( $renders ) ) : ?>
				<div class="hgd-portal-card">
					<h2><?php esc_html_e( 'Your concept', 'hillcroft-garden-designer' ); ?></h2>
					<div class="hgd-portal-gallery">
						<?php foreach ( $renders as $r ) :
							$url = wp_get_attachment_image_url( (int) $r['attachment_id'], 'large' );
							if ( ! $url ) { continue; }
							?>
							<img src="<?php echo esc_url( $url ); ?>" alt="<?php esc_attr_e( 'Garden concept render', 'hillcroft-garden-designer' ); ?>" />
						<?php endforeach; ?>
					</div>
				</div>
			<?php endif; ?>

			<div class="hgd-portal-card">
				<h2><?php esc_html_e( 'Your investment', 'hillcroft-garden-designer' ); ?></h2>
				<table class="hgd-portal-totals">
					<tbody>
						<tr><td><?php esc_html_e( 'Planting &amp; materials', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['planting'] ) ); ?></td></tr>
						<tr><td><?php esc_html_e( 'Labour &amp; installation', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['labour'] ) ); ?></td></tr>
						<?php if ( $breakdown['design_fee'] > 0 ) : ?>
							<tr><td><?php esc_html_e( 'Design fee', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['design_fee'] ) ); ?></td></tr>
						<?php endif; ?>
						<?php if ( $breakdown['vat'] > 0 ) : ?>
							<tr><td><?php esc_html_e( 'Subtotal', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['subtotal'] ) ); ?></td></tr>
							<tr><td><?php esc_html_e( 'VAT', 'hillcroft-garden-designer' ); ?></td><td class="num"><?php echo esc_html( $money( $breakdown['vat'] ) ); ?></td></tr>
						<?php endif; ?>
						<tr class="hgd-portal-total"><td><strong><?php esc_html_e( 'Total', 'hillcroft-garden-designer' ); ?></strong></td><td class="num"><strong><?php echo esc_html( $money( $proposal['total_gbp'] ) ); ?></strong></td></tr>
					</tbody>
				</table>
			</div>

			<div class="hgd-portal-card">
				<h2><?php esc_html_e( 'Payment schedule', 'hillcroft-garden-designer' ); ?></h2>
				<table class="hgd-portal-totals">
					<tbody>
						<?php foreach ( $payments as $p ) : ?>
							<tr>
								<td>
									<?php echo esc_html( $p['label'] ); ?>
									<?php if ( 'paid' === $p['status'] ) : ?>
										<span class="hgd-portal-tag hgd-portal-tag-paid"><?php esc_html_e( 'Paid', 'hillcroft-garden-designer' ); ?></span>
									<?php else : ?>
										<span class="hgd-portal-tag"><?php esc_html_e( 'Due', 'hillcroft-garden-designer' ); ?></span>
									<?php endif; ?>
								</td>
								<td class="num"><?php echo esc_html( $money( $p['amount_gbp'] ) ); ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			</div>

			<?php if ( '' !== trim( (string) $proposal['terms_text'] ) ) : ?>
				<div class="hgd-portal-card">
					<h2><?php esc_html_e( 'Terms &amp; conditions', 'hillcroft-garden-designer' ); ?></h2>
					<div class="hgd-portal-terms"><?php echo wp_kses_post( wpautop( $proposal['terms_text'] ) ); ?></div>
				</div>
			<?php endif; ?>

			<?php if ( ! $is_accepted ) : ?>
				<div class="hgd-portal-card" id="hgd-portal-sign">
					<h2><?php esc_html_e( 'Accept &amp; sign', 'hillcroft-garden-designer' ); ?></h2>
					<p class="hgd-portal-muted"><?php esc_html_e( 'Type your full name to accept this proposal and its terms. You’ll then be able to pay the deposit to begin.', 'hillcroft-garden-designer' ); ?></p>
					<div class="hgd-portal-field">
						<label for="hgd-sign-name"><?php esc_html_e( 'Your full name', 'hillcroft-garden-designer' ); ?></label>
						<input type="text" id="hgd-sign-name" autocomplete="name" />
					</div>
					<p class="hgd-portal-err" id="hgd-sign-err" hidden></p>
					<button type="button" class="hgd-portal-btn" id="hgd-sign-btn"><?php esc_html_e( 'Accept proposal', 'hillcroft-garden-designer' ); ?></button>
				</div>
			<?php else : ?>
				<div class="hgd-portal-card">
					<h2><?php esc_html_e( 'Accepted', 'hillcroft-garden-designer' ); ?></h2>
					<p class="hgd-portal-muted">
						<?php
						echo esc_html( sprintf(
							/* translators: 1: signatory name 2: date */
							__( 'Signed by %1$s on %2$s. Thank you.', 'hillcroft-garden-designer' ),
							$proposal['signature_name'] ? $proposal['signature_name'] : __( 'you', 'hillcroft-garden-designer' ),
							$proposal['signed_at'] ? mysql2date( 'j F Y', $proposal['signed_at'] ) : ''
						) );
						?>
					</p>
				</div>

				<div class="hgd-portal-card" id="hgd-portal-pay">
					<h2><?php esc_html_e( 'Pay your deposit', 'hillcroft-garden-designer' ); ?></h2>
					<?php if ( $deposit_paid ) : ?>
						<p class="hgd-portal-success">✓ <?php echo esc_html( sprintf( __( 'Your %s deposit has been received — we’ll be in touch to schedule the work. Thank you!', 'hillcroft-garden-designer' ), $money( $deposit['amount_gbp'] ) ) ); ?></p>
					<?php elseif ( ! $configured ) : ?>
						<p class="hgd-portal-muted"><?php esc_html_e( 'Online payment isn’t available just now — we’ll send you payment details directly.', 'hillcroft-garden-designer' ); ?></p>
					<?php elseif ( $deposit ) : ?>
						<p class="hgd-portal-muted"><?php echo esc_html( sprintf( __( 'A deposit of %s secures your project and start date.', 'hillcroft-garden-designer' ), $money( $deposit['amount_gbp'] ) ) ); ?></p>
						<div class="hgd-portal-payment-element" id="hgd-payment-element"></div>
						<p class="hgd-portal-err" id="hgd-pay-err" hidden></p>
						<button type="button" class="hgd-portal-btn" id="hgd-pay-btn" data-payment-id="<?php echo esc_attr( (int) $deposit['id'] ); ?>"><?php echo esc_html( sprintf( __( 'Pay %s deposit', 'hillcroft-garden-designer' ), $money( $deposit['amount_gbp'] ) ) ); ?></button>
					<?php endif; ?>
				</div>
			<?php endif; ?>

			<footer class="hgd-portal-foot">
				<p><?php echo esc_html( get_bloginfo( 'name' ) ); ?></p>
			</footer>
		</main>

		<?php if ( $configured && $is_accepted && $deposit && ! $deposit_paid ) : ?>
			<script src="https://js.stripe.com/v3/"></script>
		<?php endif; ?>
		<script>
		<?php echo self::portal_js( $proposal, $configured && $is_accepted && $deposit && ! $deposit_paid, (string) $s['stripe_pub_key'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</script>
		</body></html>
		<?php
	}

	// -------------------------------------------------------------------------
	// Inline assets
	// -------------------------------------------------------------------------

	/** The <head> + opening <body> with inline brand CSS. */
	private static function doc_head( $title ) {
		$s        = HGD_Settings::all();
		$olive    = sanitize_hex_color( $s['brand_olive'] ) ?: '#494A20';
		$charcoal = sanitize_hex_color( $s['brand_charcoal'] ) ?: '#1B1C18';
		$cream    = sanitize_hex_color( $s['brand_cream'] ) ?: '#F2ECDD';

		ob_start();
		?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title><?php echo esc_html( $title . ' — ' . get_bloginfo( 'name' ) ); ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
:root{--hgd-olive:<?php echo esc_html( $olive ); ?>;--hgd-charcoal:<?php echo esc_html( $charcoal ); ?>;--hgd-cream:<?php echo esc_html( $cream ); ?>;--hgd-paper:#FBF9F3;--hgd-green:#9FA145;--hgd-line:rgba(73,74,32,.16);}
*{box-sizing:border-box;}
body{margin:0;background:var(--hgd-cream);color:var(--hgd-charcoal);font-family:"DM Sans",system-ui,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;}
h1,h2,h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;color:var(--hgd-olive);line-height:1.15;margin:0 0 .5em;}
h1{font-size:2.4rem;}
h2{font-size:1.7rem;}
.hgd-portal-wrap{max-width:720px;margin:0 auto;padding:32px 20px 64px;}
.hgd-portal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.hgd-portal-mark{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.4rem;font-weight:600;letter-spacing:.02em;color:var(--hgd-olive);}
.hgd-portal-badge{background:var(--hgd-green);color:#fff;border-radius:999px;padding:5px 14px;font-size:.8rem;font-weight:500;letter-spacing:.03em;}
.hgd-portal-card{background:var(--hgd-paper);border:1px solid var(--hgd-line);border-radius:16px;padding:26px 28px;margin-bottom:20px;box-shadow:0 1px 2px rgba(27,28,24,.04);}
.hgd-portal-center{text-align:center;}
.hgd-portal-center .hgd-portal-mark{margin-bottom:14px;}
.hgd-portal-muted{color:rgba(27,28,24,.62);}
.hgd-portal-intro p{margin:.5em 0;}
.hgd-portal-gallery{display:grid;grid-template-columns:1fr;gap:14px;}
.hgd-portal-gallery img{width:100%;height:auto;border-radius:12px;display:block;}
.hgd-portal-totals{width:100%;border-collapse:collapse;}
.hgd-portal-totals td{padding:9px 0;border-bottom:1px solid var(--hgd-line);}
.hgd-portal-totals tr:last-child td{border-bottom:none;}
.hgd-portal-totals td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.hgd-portal-total td{border-top:2px solid var(--hgd-olive);padding-top:12px;font-size:1.15rem;}
.hgd-portal-tag{display:inline-block;margin-left:8px;font-size:.72rem;font-weight:500;border-radius:999px;padding:2px 9px;background:rgba(73,74,32,.1);color:var(--hgd-olive);}
.hgd-portal-tag-paid{background:var(--hgd-green);color:#fff;}
.hgd-portal-terms{max-height:340px;overflow:auto;font-size:.92rem;color:rgba(27,28,24,.78);}
.hgd-portal-field{margin:14px 0;}
.hgd-portal-field label{display:block;font-weight:500;margin-bottom:6px;font-size:.92rem;}
.hgd-portal-field input{width:100%;padding:12px 14px;border:1px solid var(--hgd-line);border-radius:10px;font:inherit;background:#fff;}
.hgd-portal-payment-element{margin:16px 0;}
.hgd-portal-btn{appearance:none;border:none;cursor:pointer;background:var(--hgd-olive);color:#fff;font:inherit;font-weight:500;border-radius:999px;padding:13px 28px;transition:transform .12s ease,box-shadow .12s ease,opacity .12s ease;}
.hgd-portal-btn:hover{box-shadow:0 4px 14px rgba(73,74,32,.35);transform:translateY(-1px);}
.hgd-portal-btn:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none;}
.hgd-portal-err{color:#9b2226;font-size:.9rem;margin:10px 0 0;}
.hgd-portal-success{color:var(--hgd-olive);font-weight:500;}
.hgd-portal-foot{text-align:center;color:rgba(27,28,24,.5);font-size:.85rem;margin-top:34px;}
@media(min-width:560px){.hgd-portal-gallery{grid-template-columns:1fr 1fr;}}
</style>
</head>
<body>
		<?php
		return ob_get_clean();
	}

	/** Inline JS for accept + Stripe deposit payment (mirrors booking.js). */
	private static function portal_js( array $proposal, $with_stripe, $pub_key ) {
		$cfg = array(
			'rest'    => esc_url_raw( rest_url( self::NS ) ),
			'token'   => $proposal['token'],
			'pub_key' => (string) $pub_key,
			'stripe'  => (bool) $with_stripe,
			'reload'  => esc_url_raw( HGD_Proposal::portal_url( $proposal ) ),
			'i18n'    => array(
				'name'    => __( 'Please type your full name to sign.', 'hillcroft-garden-designer' ),
				'error'   => __( 'Something went wrong. Please try again.', 'hillcroft-garden-designer' ),
				'paying'  => __( 'Processing payment…', 'hillcroft-garden-designer' ),
			),
		);

		ob_start();
		?>
( function () {
	'use strict';
	var CFG = <?php echo wp_json_encode( $cfg ); ?>;

	function api( path, body ) {
		return fetch( CFG.rest + path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( body )
		} ).then( function ( r ) {
			return r.json().then( function ( data ) {
				return { ok: r.ok, status: r.status, data: data };
			} );
		} );
	}

	function setErr( el, msg ) {
		if ( ! el ) { return; }
		if ( msg ) { el.textContent = msg; el.hidden = false; }
		else { el.hidden = true; }
	}

	// --- Accept + sign -----------------------------------------------------
	var signBtn = document.getElementById( 'hgd-sign-btn' );
	if ( signBtn ) {
		signBtn.addEventListener( 'click', function () {
			var nameEl = document.getElementById( 'hgd-sign-name' );
			var errEl  = document.getElementById( 'hgd-sign-err' );
			var name   = ( nameEl.value || '' ).trim();
			setErr( errEl, '' );
			if ( name.length < 2 ) { setErr( errEl, CFG.i18n.name ); return; }
			signBtn.disabled = true;
			api( '/proposal/accept', { token: CFG.token, signature_name: name } ).then( function ( res ) {
				if ( ! res.ok ) {
					signBtn.disabled = false;
					setErr( errEl, ( res.data && res.data.message ) ? res.data.message : CFG.i18n.error );
					return;
				}
				window.location.href = CFG.reload;
			} ).catch( function () {
				signBtn.disabled = false;
				setErr( errEl, CFG.i18n.error );
			} );
		} );
	}

	// --- Deposit payment (Stripe Payment Element) --------------------------
	var payBtn = document.getElementById( 'hgd-pay-btn' );
	if ( CFG.stripe && payBtn && typeof Stripe !== 'undefined' ) {
		var stripe   = Stripe( CFG.pub_key );
		var elements = null;
		var errEl    = document.getElementById( 'hgd-pay-err' );
		var paymentId = payBtn.getAttribute( 'data-payment-id' );

		api( '/proposal/pay', { token: CFG.token, payment_id: paymentId } ).then( function ( res ) {
			if ( ! res.ok || ! res.data.client_secret ) {
				setErr( errEl, ( res.data && res.data.message ) ? res.data.message : CFG.i18n.error );
				payBtn.disabled = true;
				return;
			}
			elements = stripe.elements( { clientSecret: res.data.client_secret } );
			var pe = elements.create( 'payment' );
			pe.mount( document.getElementById( 'hgd-payment-element' ) );
		} ).catch( function () {
			setErr( errEl, CFG.i18n.error );
			payBtn.disabled = true;
		} );

		payBtn.addEventListener( 'click', function () {
			if ( ! elements ) { return; }
			setErr( errEl, '' );
			var label = payBtn.textContent;
			payBtn.disabled = true;
			payBtn.textContent = CFG.i18n.paying;
			stripe.confirmPayment( { elements: elements, redirect: 'if_required' } ).then( function ( result ) {
				if ( result.error ) {
					setErr( errEl, result.error.message || CFG.i18n.error );
					payBtn.disabled = false;
					payBtn.textContent = label;
					return;
				}
				if ( result.paymentIntent && result.paymentIntent.status === 'succeeded' ) {
					window.location.href = CFG.reload;
				} else {
					setErr( errEl, CFG.i18n.error );
					payBtn.disabled = false;
					payBtn.textContent = label;
				}
			} ).catch( function () {
				setErr( errEl, CFG.i18n.error );
				payBtn.disabled = false;
				payBtn.textContent = label;
			} );
		} );
	}
} )();
		<?php
		return ob_get_clean();
	}

	// -------------------------------------------------------------------------
	// REST routes
	// -------------------------------------------------------------------------

	public static function register_routes() {
		register_rest_route( self::NS, '/proposal/accept', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'rest_accept' ),
		) );

		register_rest_route( self::NS, '/proposal/pay', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'rest_pay' ),
		) );
	}

	/** Resolve a live (non-expired, non-draft) proposal from a request token. */
	private static function proposal_from_request( $request ) {
		$token    = preg_replace( '/[^A-Za-z0-9]/', '', (string) $request->get_param( 'token' ) );
		$proposal = HGD_Proposal::get_by_token( $token );
		if ( ! $proposal || 'draft' === $proposal['status'] || HGD_Proposal::is_expired( $proposal ) ) {
			return null;
		}
		return $proposal;
	}

	public static function rest_accept( $request ) {
		$proposal = self::proposal_from_request( $request );
		if ( ! $proposal ) {
			return new WP_Error( 'hgd_bad_token', __( 'This proposal is no longer available.', 'hillcroft-garden-designer' ), array( 'status' => 404 ) );
		}

		$name = sanitize_text_field( (string) $request->get_param( 'signature_name' ) );
		if ( strlen( trim( $name ) ) < 2 ) {
			return new WP_Error( 'hgd_bad_sign', __( 'Please type your full name to sign.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}

		// Idempotent: if already accepted, just confirm.
		if ( ! in_array( $proposal['status'], array( 'accepted', 'deposit_paid', 'complete' ), true ) ) {
			$now = current_time( 'mysql' );
			HGD_Proposal::update( (int) $proposal['id'], array(
				'signature_name' => $name,
				'signed_at'      => $now,
				'status'         => 'accepted',
				'accepted_at'    => $now,
			) );
			if ( ! empty( $proposal['project_id'] ) ) {
				HGD_Project::update( (int) $proposal['project_id'], array( 'status' => 'accepted' ) );
			}
		}

		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	public static function rest_pay( $request ) {
		$proposal = self::proposal_from_request( $request );
		if ( ! $proposal ) {
			return new WP_Error( 'hgd_bad_token', __( 'This proposal is no longer available.', 'hillcroft-garden-designer' ), array( 'status' => 404 ) );
		}

		// Must be accepted before any payment can be taken.
		if ( ! in_array( $proposal['status'], array( 'accepted', 'deposit_paid', 'complete' ), true ) ) {
			return new WP_Error( 'hgd_not_accepted', __( 'Please accept the proposal before paying.', 'hillcroft-garden-designer' ), array( 'status' => 409 ) );
		}

		$s = HGD_Settings::all();
		if ( ! HGD_Stripe::is_configured() || '' === (string) $s['stripe_pub_key'] ) {
			return new WP_Error( 'hgd_not_configured', __( 'Online payment is not available right now.', 'hillcroft-garden-designer' ), array( 'status' => 503 ) );
		}

		$payment_id = (int) $request->get_param( 'payment_id' );
		$payment    = $payment_id ? HGD_Payment::get( $payment_id ) : null;

		// Rigorously verify ownership: the payment must belong to THIS proposal.
		if ( ! $payment || (int) $payment['proposal_id'] !== (int) $proposal['id'] ) {
			return new WP_Error( 'hgd_bad_payment', __( 'That payment could not be found.', 'hillcroft-garden-designer' ), array( 'status' => 404 ) );
		}
		if ( 'paid' === $payment['status'] ) {
			return new WP_Error( 'hgd_already_paid', __( 'This milestone has already been paid.', 'hillcroft-garden-designer' ), array( 'status' => 409 ) );
		}

		// Always re-derive the amount from the stored row — never trust the client.
		$amount_pence = (int) round( (float) $payment['amount_gbp'] * 100 );
		if ( $amount_pence < 1 ) {
			return new WP_Error( 'hgd_bad_amount', __( 'This milestone has no payable amount.', 'hillcroft-garden-designer' ), array( 'status' => 400 ) );
		}

		$intent = HGD_Stripe::create_payment_intent(
			$amount_pence,
			'gbp',
			array(
				'hgd_kind'    => 'payment',
				'payment_id'  => (string) $payment['id'],
				'proposal_id' => (string) $proposal['id'],
				'milestone'   => (string) $payment['milestone'],
			)
		);

		if ( is_wp_error( $intent ) ) {
			return new WP_Error( 'hgd_stripe_failed', $intent->get_error_message(), array( 'status' => 502 ) );
		}

		// Store the intent id against the payment so the webhook can match it.
		HGD_Payment::update( (int) $payment['id'], array(
			'stripe_payment_intent' => sanitize_text_field( $intent['id'] ),
		) );

		return new WP_REST_Response( array(
			'client_secret' => $intent['client_secret'],
			'pub_key'       => (string) $s['stripe_pub_key'],
		), 200 );
	}
}

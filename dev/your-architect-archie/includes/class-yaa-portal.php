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
	}

	/** Portal URL for a project (creates the token on first use). */
	public static function url( $project_id ) {
		$token   = YAA_Project::ensure_token( $project_id );
		$page_id = (int) YAA_Settings::get( 'portal_page_id', 0 );
		$base    = ( $page_id && get_post_status( $page_id ) ) ? get_permalink( $page_id ) : home_url( '/' );
		return add_query_arg( 'token', $token, $base );
	}

	private static function assets( $project ) {
		wp_register_style( 'yaa-fonts', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap', array(), null );
		wp_enqueue_style( 'yaa-fonts' );
		wp_register_style( 'yaa-portal', YAA_URL . 'assets/css/portal.css', array( 'yaa-fonts' ), YAA_VERSION );
		wp_enqueue_style( 'yaa-portal' );
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
		</div>
		<?php
		return ob_get_clean();
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

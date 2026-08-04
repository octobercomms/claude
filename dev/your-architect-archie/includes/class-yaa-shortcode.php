<?php
/**
 * The [archie] shortcode + an Elementor widget, plus asset loading.
 *
 * Drop [archie] into any page (or use the "Archie" Elementor widget). Renders
 * the two-panel builder and points it at the yaa/v1 REST endpoints. The visual
 * design is self-contained in assets/css/archie.css so it looks right in any
 * theme (Jupiter X included).
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Shortcode {

	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
		add_shortcode( 'archie', array( __CLASS__, 'render' ) );
		add_action( 'elementor/widgets/register', array( __CLASS__, 'register_elementor' ) );
	}

	public static function register_assets() {
		wp_register_style( 'yaa-fonts', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap', array(), null );
		wp_register_style( 'yaa-archie', YAA_URL . 'assets/css/archie.css', array( 'yaa-fonts' ), YAA_VERSION );
		wp_register_script( 'yaa-archie', YAA_URL . 'assets/js/archie.js', array(), YAA_VERSION, true );
		wp_localize_script(
			'yaa-archie',
			'yaaData',
			array(
				'rest'    => esc_url_raw( rest_url( 'yaa/v1/' ) ),
				'nonce'   => wp_create_nonce( 'yaa_rest' ),
				'pricing' => YAA_Pricing::public_data(),
			)
		);
	}

	private static function face_svg() {
		return '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="#E4EFF7"/><path d="M11 20c0-8 6-13 13-13s13 5 13 13" stroke="#253E94" stroke-width="3.4" stroke-linecap="round"/><path d="M12 21c2.5-2 6-3 6-3M36 21c-2.5-2-6-3-6-3" stroke="#253E94" stroke-width="2.2" stroke-linecap="round"/><circle cx="18.5" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><circle cx="30" cy="25" r="4.4" stroke="#253E94" stroke-width="2.4"/><path d="M22.9 25h2.2" stroke="#253E94" stroke-width="2.4" stroke-linecap="round"/><path d="M19 34c2 1.8 8 1.8 10 0" stroke="#253E94" stroke-width="2.6" stroke-linecap="round"/></svg>';
	}

	public static function render( $atts = array() ) {
		wp_enqueue_style( 'yaa-archie' );
		wp_enqueue_script( 'yaa-archie' );
		$face = self::face_svg();
		ob_start();
		?>
		<div class="yaa"><div class="archie-embed">
			<div class="ob-top">
				<span class="ob-title"><span class="archie-face"><?php echo $face; // phpcs:ignore ?></span> <?php esc_html_e( 'Talk to Archie — your personalised price builds as you answer', 'your-architect-archie' ); ?></span>
				<div class="ob-actions"><button class="btn btn-outline" id="restartBtn" type="button"><?php esc_html_e( 'Start over', 'your-architect-archie' ); ?></button></div>
			</div>
			<div class="ob-body">
				<section class="ob-chat" aria-label="<?php esc_attr_e( 'Conversation', 'your-architect-archie' ); ?>">
					<div class="ob-messages" id="messages"><div class="wrapmsg" id="msgList"></div></div>
					<div class="ob-composer">
						<div class="ob-composer-inner">
							<div class="composer-row" id="composerRow">
								<div class="composer-input">
									<textarea id="textInput" rows="1" placeholder="<?php esc_attr_e( 'Type your answer…', 'your-architect-archie' ); ?>" autocomplete="off"></textarea>
									<button class="icon-btn" id="micBtn" type="button" title="<?php esc_attr_e( 'Voice input', 'your-architect-archie' ); ?>" aria-label="<?php esc_attr_e( 'Voice input', 'your-architect-archie' ); ?>">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke-linecap="round"/></svg>
									</button>
								</div>
								<button class="icon-btn send" id="sendBtn" type="button" title="<?php esc_attr_e( 'Send', 'your-architect-archie' ); ?>" aria-label="<?php esc_attr_e( 'Send', 'your-architect-archie' ); ?>">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h15M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
								</button>
							</div>
						</div>
					</div>
				</section>
				<aside class="ob-panel" id="packagePanel" aria-label="<?php esc_attr_e( 'Your project and price', 'your-architect-archie' ); ?>">
					<button class="ob-panel-toggle" id="panelToggle" type="button"><span><?php esc_html_e( 'Your project', 'your-architect-archie' ); ?></span><span class="tt-amt" id="toggleTotal">£0</span></button>
					<div class="ob-panel-head">
						<div class="ph-row"><h2><?php esc_html_e( 'Your project', 'your-architect-archie' ); ?></h2><span class="ph-chip" id="londonChip"><?php esc_html_e( 'London pricing', 'your-architect-archie' ); ?></span></div>
						<p><?php esc_html_e( 'Your price builds as you answer. Nothing is charged now.', 'your-architect-archie' ); ?></p>
					</div>
					<div class="ob-nodes" id="nodes"><div class="node-empty" id="nodesEmpty"><?php esc_html_e( 'Your package appears here as you answer Archie.', 'your-architect-archie' ); ?></div></div>
					<div class="ob-panel-foot">
						<div class="redirect-banner" id="redirectBanner"><strong><?php esc_html_e( 'A better fit for a full commission', 'your-architect-archie' ); ?></strong><p><?php esc_html_e( 'A project this size or scope is usually best handled by Tiam Architects. You can still submit here, or request a consultation.', 'your-architect-archie' ); ?></p></div>
						<div class="total-row"><span class="t-label"><?php esc_html_e( 'Total', 'your-architect-archie' ); ?></span><span class="t-amt" id="totalAmt">£0</span></div>
						<p class="total-sub" id="totalSub"><?php esc_html_e( 'Fixed price · survey included where added', 'your-architect-archie' ); ?></p>
						<div class="quote-meta" id="quoteMeta" hidden>
							<div><?php esc_html_e( 'Delivery in', 'your-architect-archie' ); ?> <strong id="mDelivery">3–7 working days</strong></div>
							<div><span id="mRevisions">2 revisions included</span></div>
							<div><?php esc_html_e( 'Quote valid until', 'your-architect-archie' ); ?> <strong id="mValidity">—</strong></div>
						</div>
						<button class="btn btn-primary btn-block submit-btn" id="submitBtn" type="button" disabled><?php esc_html_e( 'Save & submit project', 'your-architect-archie' ); ?></button>
					</div>
				</aside>
			</div>
		</div></div>
		<?php
		return ob_get_clean();
	}

	/** Register a thin Elementor widget that outputs the shortcode. */
	public static function register_elementor( $widgets_manager ) {
		if ( ! class_exists( '\Elementor\Widget_Base' ) ) {
			return;
		}
		require_once YAA_PATH . 'includes/class-yaa-elementor-widget.php';
		$widgets_manager->register( new YAA_Elementor_Widget() );
	}
}

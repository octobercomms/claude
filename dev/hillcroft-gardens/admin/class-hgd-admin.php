<?php
/**
 * Admin controller: menu, assets, the persistent cost banner, and form handlers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Admin {

	const CAP  = 'manage_options';
	const MENU = 'hgd-dashboard';

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menus' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'admin_post_hgd_save_plant', array( $this, 'handle_save_plant' ) );
		add_action( 'admin_post_hgd_delete_plant', array( $this, 'handle_delete_plant' ) );
		add_action( 'admin_post_hgd_save_settings', array( $this, 'handle_save_settings' ) );
		add_action( 'admin_notices', array( $this, 'maybe_low_balance_notice' ) );
	}

	// -------------------------------------------------------------------------
	// Menu
	// -------------------------------------------------------------------------

	public function register_menus() {
		add_menu_page(
			__( 'Hillcroft Garden Designer', 'hillcroft-garden-designer' ),
			__( 'Hillcroft', 'hillcroft-garden-designer' ),
			self::CAP,
			self::MENU,
			array( $this, 'render_dashboard' ),
			'dashicons-palmtree',
			3
		);

		add_submenu_page( self::MENU, __( 'Dashboard', 'hillcroft-garden-designer' ), __( 'Dashboard', 'hillcroft-garden-designer' ), self::CAP, self::MENU, array( $this, 'render_dashboard' ) );
		add_submenu_page( self::MENU, __( 'Plant Catalogue', 'hillcroft-garden-designer' ), __( 'Plant Catalogue', 'hillcroft-garden-designer' ), self::CAP, 'hgd-plants', array( $this, 'render_plants' ) );
		add_submenu_page( self::MENU, __( 'Settings', 'hillcroft-garden-designer' ), __( 'Settings', 'hillcroft-garden-designer' ), self::CAP, 'hgd-settings', array( $this, 'render_settings' ) );
	}

	private function is_plugin_screen() {
		$screen = get_current_screen();
		return $screen && false !== strpos( $screen->id, 'hgd-' ) || ( $screen && false !== strpos( $screen->id, self::MENU ) );
	}

	// -------------------------------------------------------------------------
	// Assets + brand styling
	// -------------------------------------------------------------------------

	public function enqueue_assets( $hook ) {
		if ( ! $this->is_plugin_screen() ) {
			return;
		}

		// Brand fonts (Cormorant Garamond + DM Sans). Loaded from Google Fonts for
		// now; self-hosting is tracked for a later pass.
		wp_enqueue_style(
			'hgd-fonts',
			'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;700&display=swap',
			array(),
			null
		);

		wp_enqueue_style( 'hgd-admin', HGD_URL . 'admin/css/admin.css', array( 'hgd-fonts' ), HGD_VERSION );
		wp_enqueue_script( 'hgd-admin', HGD_URL . 'admin/js/admin.js', array(), HGD_VERSION, true );

		// Expose the brand palette as CSS variables so the stylesheet stays in sync
		// with settings.
		$s   = HGD_Settings::all();
		$css = sprintf(
			':root{--hgd-olive:%s;--hgd-charcoal:%s;--hgd-cream:%s;}',
			esc_html( $s['brand_olive'] ),
			esc_html( $s['brand_charcoal'] ),
			esc_html( $s['brand_cream'] )
		);
		wp_add_inline_style( 'hgd-admin', $css );
	}

	// -------------------------------------------------------------------------
	// Persistent cost banner (rendered at the top of every plugin screen)
	// -------------------------------------------------------------------------

	public function render_cost_banner() {
		$state = HGD_API_Usage::banner_state();
		$cap   = $state['cap'] > 0 ? '£' . number_format( $state['cap'], 0 ) : '—';
		include HGD_PATH . 'admin/views/cost-banner.php';
	}

	/** Site-wide nudge when something needs attention (fires on any admin screen). */
	public function maybe_low_balance_notice() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$state = HGD_API_Usage::banner_state();
		if ( 'green' === $state['level'] ) {
			return;
		}
		$class = 'red' === $state['level'] ? 'notice-error' : 'notice-warning';
		$msg   = 'red' === $state['level']
			? __( 'Hillcroft Garden Designer: monthly API spend has reached your soft cap, or plant-ID credits have run out.', 'hillcroft-garden-designer' )
			: __( 'Hillcroft Garden Designer: API spend is approaching your soft cap, or plant-ID credits are running low.', 'hillcroft-garden-designer' );
		printf(
			'<div class="notice %s is-dismissible"><p>%s <a href="%s">%s</a></p></div>',
			esc_attr( $class ),
			esc_html( $msg ),
			esc_url( admin_url( 'admin.php?page=hgd-settings' ) ),
			esc_html__( 'Review settings', 'hillcroft-garden-designer' )
		);
	}

	// -------------------------------------------------------------------------
	// Page renderers
	// -------------------------------------------------------------------------

	public function render_dashboard() {
		$this->guard();
		$banner_cb   = array( $this, 'render_cost_banner' );
		$plant_count = HGD_Plant::count();
		$by_api      = HGD_API_Usage::spend_by_api_this_month();
		$state       = HGD_API_Usage::banner_state();
		include HGD_PATH . 'admin/views/dashboard.php';
	}

	public function render_plants() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$action    = isset( $_GET['action'] ) ? sanitize_key( $_GET['action'] ) : 'list'; // phpcs:ignore WordPress.Security.NonceVerification

		if ( 'edit' === $action || 'new' === $action ) {
			$plant = array();
			if ( 'edit' === $action && isset( $_GET['id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$plant = HGD_Plant::get( (int) $_GET['id'] );
				if ( ! $plant ) {
					wp_die( esc_html__( 'Plant not found.', 'hillcroft-garden-designer' ) );
				}
			}
			include HGD_PATH . 'admin/views/plant-form.php';
			return;
		}

		$search   = isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( $_GET['s'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$type     = isset( $_GET['type'] ) ? sanitize_key( $_GET['type'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$paged    = isset( $_GET['paged'] ) ? max( 1, (int) $_GET['paged'] ) : 1; // phpcs:ignore WordPress.Security.NonceVerification
		$per_page = 25;
		$result   = HGD_Plant::query( array( 'search' => $search, 'type' => $type, 'per_page' => $per_page, 'page' => $paged ) );
		include HGD_PATH . 'admin/views/plants.php';
	}

	public function render_settings() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$s         = HGD_Settings::all();
		$saved     = isset( $_GET['updated'] ); // phpcs:ignore WordPress.Security.NonceVerification
		include HGD_PATH . 'admin/views/settings.php';
	}

	// -------------------------------------------------------------------------
	// Form handlers
	// -------------------------------------------------------------------------

	public function handle_save_plant() {
		$this->guard();
		check_admin_referer( 'hgd_save_plant' );

		$id    = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		$clean = HGD_Plant::sanitise( $_POST );

		if ( '' === $clean['botanical_name'] && '' === $clean['common_name'] ) {
			$this->redirect_with( 'hgd-plants', array( 'action' => $id ? 'edit' : 'new', 'id' => $id ?: null, 'error' => 'name' ) );
		}

		if ( $id ) {
			HGD_Plant::update( $id, $clean );
		} else {
			$id = HGD_Plant::insert( $clean );
		}

		$this->redirect_with( 'hgd-plants', array( 'updated' => 1 ) );
	}

	public function handle_delete_plant() {
		$this->guard();
		$id = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		check_admin_referer( 'hgd_delete_plant_' . $id );
		if ( $id ) {
			HGD_Plant::delete( $id );
		}
		$this->redirect_with( 'hgd-plants', array( 'deleted' => 1 ) );
	}

	public function handle_save_settings() {
		$this->guard();
		check_admin_referer( 'hgd_save_settings' );

		$raw   = wp_unslash( $_POST );
		$input = array();

		// Strings / secrets.
		foreach ( array(
			'claude_api_key', 'gemini_api_key', 'google_maps_api_key', 'plantid_api_key',
			'stripe_secret_key', 'stripe_pub_key', 'github_repo', 'github_token',
			'github_tag_prefix', 'brand_olive', 'brand_charcoal', 'brand_cream',
		) as $key ) {
			if ( isset( $raw[ $key ] ) ) {
				$input[ $key ] = sanitize_text_field( $raw[ $key ] );
			}
		}

		// Numbers.
		foreach ( array(
			'usd_to_gbp', 'eur_to_gbp', 'rate_claude_per_mtok_usd', 'rate_gemini_per_image_usd',
			'rate_maps_per_1k_usd', 'rate_plantid_per_credit_eur', 'soft_monthly_cap_gbp',
			'consultation_fee_gbp', 'deposit_pct', 'commencement_pct', 'completion_pct',
			'plantid_credits_balance',
		) as $key ) {
			if ( isset( $raw[ $key ] ) ) {
				$input[ $key ] = (float) $raw[ $key ];
			}
		}

		$input['auto_update'] = empty( $raw['auto_update'] ) ? 0 : 1;

		HGD_Settings::save( $input );
		$this->redirect_with( 'hgd-settings', array( 'updated' => 1 ) );
	}

	// -------------------------------------------------------------------------

	private function guard() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'hillcroft-garden-designer' ) );
		}
	}

	private function redirect_with( $page, array $args ) {
		$args = array_merge( array( 'page' => $page ), array_filter( $args, function ( $v ) { return null !== $v; } ) );
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}

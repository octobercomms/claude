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
		add_action( 'admin_post_hgd_plants_export', array( $this, 'handle_plants_export' ) );
		add_action( 'admin_post_hgd_plants_import', array( $this, 'handle_plants_import' ) );
		add_action( 'admin_post_hgd_plant_fetch_photo', array( $this, 'handle_plant_fetch_photo' ) );
		add_action( 'admin_post_hgd_chat_send', array( $this, 'handle_chat_send' ) );
		add_action( 'admin_post_hgd_chat_clear', array( $this, 'handle_chat_clear' ) );
		add_action( 'admin_post_hgd_save_settings', array( $this, 'handle_save_settings' ) );
		add_action( 'admin_post_hgd_save_project', array( $this, 'handle_save_project' ) );
		add_action( 'admin_post_hgd_delete_project', array( $this, 'handle_delete_project' ) );
		add_action( 'admin_post_hgd_upload_assets', array( $this, 'handle_upload_assets' ) );
		add_action( 'admin_post_hgd_delete_asset', array( $this, 'handle_delete_asset' ) );
		add_action( 'admin_post_hgd_claude_read', array( $this, 'handle_claude_read' ) );
		add_action( 'admin_post_hgd_save_measurements', array( $this, 'handle_save_measurements' ) );
		add_action( 'admin_post_hgd_save_design', array( $this, 'handle_save_design' ) );
		add_action( 'admin_post_hgd_compose_prompt', array( $this, 'handle_compose_prompt' ) );
		add_action( 'admin_post_hgd_generate_render', array( $this, 'handle_generate_render' ) );
		add_action( 'admin_post_hgd_generate_photo_render', array( $this, 'handle_generate_photo_render' ) );
		add_action( 'admin_post_hgd_generate_flux_render', array( $this, 'handle_generate_flux_render' ) );
		add_action( 'admin_post_hgd_approve_render', array( $this, 'handle_approve_render' ) );
		add_action( 'admin_post_hgd_score_render', array( $this, 'handle_score_render' ) );
		add_action( 'admin_post_hgd_generate_plan', array( $this, 'handle_generate_plan' ) );
		add_action( 'admin_post_hgd_save_plan_prompt', array( $this, 'handle_save_plan_prompt' ) );
		add_action( 'admin_post_hgd_compose_plan_prompt', array( $this, 'handle_compose_plan_prompt' ) );
		add_action( 'admin_post_hgd_pack_generate_view', array( $this, 'handle_pack_generate_view' ) );
		add_action( 'admin_post_hgd_pack_generate_all', array( $this, 'handle_pack_generate_all' ) );
		add_action( 'admin_post_hgd_pack_fetch_satellite', array( $this, 'handle_pack_fetch_satellite' ) );
		add_action( 'admin_post_hgd_pack_seasonal', array( $this, 'handle_pack_seasonal' ) );
		add_action( 'admin_post_hgd_save_client', array( $this, 'handle_save_client' ) );
		add_action( 'admin_post_hgd_delete_client', array( $this, 'handle_delete_client' ) );
		add_action( 'admin_post_hgd_quote_init', array( $this, 'handle_quote_init' ) );
		add_action( 'admin_post_hgd_quote_save', array( $this, 'handle_quote_save' ) );
		add_action( 'admin_post_hgd_quote_add_item', array( $this, 'handle_quote_add_item' ) );
		add_action( 'admin_post_hgd_quote_add_plant', array( $this, 'handle_quote_add_plant' ) );
		add_action( 'admin_post_hgd_quote_update_item', array( $this, 'handle_quote_update_item' ) );
		add_action( 'admin_post_hgd_quote_delete_item', array( $this, 'handle_quote_delete_item' ) );
		add_action( 'admin_post_hgd_quote_seed_tiers', array( $this, 'handle_quote_seed_tiers' ) );
		add_action( 'admin_post_hgd_proposal_create', array( $this, 'handle_proposal_create' ) );
		add_action( 'admin_post_hgd_proposal_save', array( $this, 'handle_proposal_save' ) );
		add_action( 'admin_post_hgd_proposal_send', array( $this, 'handle_proposal_send' ) );
		add_action( 'admin_post_hgd_proposal_delete', array( $this, 'handle_proposal_delete' ) );
		add_action( 'admin_post_hgd_create_example', array( $this, 'handle_create_example' ) );
		add_action( 'admin_post_hgd_remove_example', array( $this, 'handle_remove_example' ) );
		add_action( 'admin_post_hgd_test_update', array( $this, 'handle_test_update' ) );
		add_action( 'admin_post_hgd_google_disconnect', array( $this, 'handle_google_disconnect' ) );
		add_action( 'admin_post_hgd_subscription_cancel', array( $this, 'handle_subscription_cancel' ) );
		add_action( 'admin_init', array( $this, 'maybe_handle_google_oauth' ) );
		add_action( 'admin_notices', array( $this, 'maybe_low_balance_notice' ) );
		add_filter( 'submenu_file', array( $this, 'highlight_forms_tab' ) );
		add_action( 'admin_head', array( $this, 'hide_forms_subpages_in_menu' ) );
	}

	/**
	 * Hide the Submissions/Analytics sidebar links (they're reached via the Forms
	 * hub tabs). They stay *registered* so the pages remain accessible — only the
	 * sidebar links are hidden, via CSS, which avoids the capability error that
	 * remove_submenu_page() caused.
	 */
	public function hide_forms_subpages_in_menu() {
		echo '<style>
			#adminmenu a[href$="page=hgd-forms-submissions"],
			#adminmenu a[href$="page=hgd-forms-analytics"] { display: none !important; }
		</style>';
	}

	/** Keep "Forms" highlighted (and the Designer submenu open) on the hidden tab pages. */
	public function highlight_forms_tab( $submenu_file ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( 'hgd-forms-submissions' === $page || 'hgd-forms-analytics' === $page ) {
			return 'hgd-forms';
		}
		return $submenu_file;
	}

	// -------------------------------------------------------------------------
	// Menu
	// -------------------------------------------------------------------------

	public function register_menus() {
		$icon_file = HGD_PATH . 'assets/img/menu-icon.svg';
		$icon      = file_exists( $icon_file )
			? 'data:image/svg+xml;base64,' . base64_encode( file_get_contents( $icon_file ) ) // phpcs:ignore WordPress.WP.AlternativeFunctions
			: 'dashicons-palmtree';

		add_menu_page(
			__( 'Hillcroft Garden Designer', 'hillcroft-garden-designer' ),
			__( 'Designer', 'hillcroft-garden-designer' ),
			self::CAP,
			self::MENU,
			array( $this, 'render_dashboard' ),
			$icon,
			3
		);

		add_submenu_page( self::MENU, __( 'Dashboard', 'hillcroft-garden-designer' ), __( 'Dashboard', 'hillcroft-garden-designer' ), self::CAP, self::MENU, array( $this, 'render_dashboard' ) );
		add_submenu_page( self::MENU, __( 'Reports', 'hillcroft-garden-designer' ), __( 'Reports', 'hillcroft-garden-designer' ), self::CAP, 'hgd-reports', array( $this, 'render_reports' ) );
		add_submenu_page( self::MENU, __( 'Projects', 'hillcroft-garden-designer' ), __( 'Projects', 'hillcroft-garden-designer' ), self::CAP, 'hgd-projects', array( $this, 'render_projects' ) );
		add_submenu_page( self::MENU, __( 'Clients', 'hillcroft-garden-designer' ), __( 'Clients', 'hillcroft-garden-designer' ), self::CAP, 'hgd-clients', array( $this, 'render_clients' ) );
		add_submenu_page( self::MENU, __( 'Forms', 'hillcroft-garden-designer' ), __( 'Forms', 'hillcroft-garden-designer' ), self::CAP, 'hgd-forms', array( $this, 'render_forms_hub' ) );
		add_submenu_page( self::MENU, __( 'Bookings', 'hillcroft-garden-designer' ), __( 'Bookings', 'hillcroft-garden-designer' ), self::CAP, 'hgd-bookings', array( $this, 'render_bookings' ) );
		add_submenu_page( self::MENU, __( 'Maintenance Plans', 'hillcroft-garden-designer' ), __( 'Maintenance Plans', 'hillcroft-garden-designer' ), self::CAP, 'hgd-subscriptions', array( $this, 'render_subscriptions' ) );
		add_submenu_page( self::MENU, __( 'Plant Catalogue', 'hillcroft-garden-designer' ), __( 'Plant Catalogue', 'hillcroft-garden-designer' ), self::CAP, 'hgd-plants', array( $this, 'render_plants' ) );
		add_submenu_page( self::MENU, __( 'Settings', 'hillcroft-garden-designer' ), __( 'Settings', 'hillcroft-garden-designer' ), self::CAP, 'hgd-settings', array( $this, 'render_settings' ) );
	}

	private function is_plugin_screen() {
		// Cheap, robust check so brand CSS loads on every plugin surface — including
		// the Forms hub tabs (Submissions/Analytics) and the hgd_form CPT screens,
		// whose screen ids don't always contain the 'hgd-' prefix.
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( '' !== $page && 0 === strpos( $page, 'hgd-' ) ) {
			return true;
		}
		$screen = get_current_screen();
		if ( ! $screen ) {
			return false;
		}
		return false !== strpos( $screen->id, 'hgd-' ) || false !== strpos( $screen->id, 'hgd_form' );
	}

	// -------------------------------------------------------------------------
	// Assets + brand styling
	// -------------------------------------------------------------------------

	public function enqueue_assets( $hook ) {
		if ( ! $this->is_plugin_screen() ) {
			return;
		}

		wp_enqueue_style(
			'hgd-fonts',
			'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;700&display=swap',
			array(),
			null
		);

		wp_enqueue_style( 'hgd-admin', HGD_URL . 'admin/css/admin.css', array( 'hgd-fonts' ), HGD_VERSION );
		wp_enqueue_script( 'hgd-admin', HGD_URL . 'admin/js/admin.js', array(), HGD_VERSION, true );

		// The media-library picker (plant image) is only needed on the plant edit/new screen.
		$page   = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$action = isset( $_GET['action'] ) ? sanitize_key( $_GET['action'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( 'hgd-plants' === $page && ( 'edit' === $action || 'new' === $action ) ) {
			wp_enqueue_media();
		}

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
	// Persistent cost banner
	// -------------------------------------------------------------------------

	public function render_cost_banner() {
		$state = HGD_API_Usage::banner_state();
		$cap   = $state['cap'] > 0 ? '£' . number_format( $state['cap'], 0 ) : '—';
		include HGD_PATH . 'admin/views/cost-banner.php';
	}

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
	// Dashboard
	// -------------------------------------------------------------------------

	public function render_dashboard() {
		$this->guard();
		$banner_cb     = array( $this, 'render_cost_banner' );
		$plant_count   = HGD_Plant::count();
		$project_count = HGD_Project::count_open();
		$client_count  = HGD_Client::count();
		$upcoming_count = HGD_Booking::count_upcoming();
		$state         = HGD_API_Usage::banner_state();
		include HGD_PATH . 'admin/views/dashboard.php';
	}

	// -------------------------------------------------------------------------
	// Reports
	// -------------------------------------------------------------------------

	public function render_reports() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );

		$rev_month = HGD_Reports::collected_revenue( 'month' );
		$rev_year  = HGD_Reports::collected_revenue( 'year' );
		$rev_all   = HGD_Reports::collected_revenue( 'all' );
		$recurring = HGD_Reports::recurring();
		$pipeline  = HGD_Reports::proposal_pipeline();
		$projects  = HGD_Reports::projects_by_status();
		$funnel    = HGD_Reports::funnel();

		include HGD_PATH . 'admin/views/reports.php';
	}

	// -------------------------------------------------------------------------
	// Bookings
	// -------------------------------------------------------------------------

	public function render_bookings() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$status    = isset( $_GET['status'] ) ? sanitize_key( $_GET['status'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		// Upcoming first, then most recent.
		$bookings  = HGD_Booking::query( array( 'status' => $status, 'orderby' => 'slot_start', 'order' => 'DESC' ) );
		include HGD_PATH . 'admin/views/bookings.php';
	}

	// -------------------------------------------------------------------------
	// Maintenance-plan subscriptions
	// -------------------------------------------------------------------------

	public function render_subscriptions() {
		$this->guard();
		$banner_cb     = array( $this, 'render_cost_banner' );
		$status        = isset( $_GET['status'] ) ? sanitize_key( $_GET['status'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$subscriptions = HGD_Subscription::all( $status );
		$plans         = HGD_Subscription::plans();
		$configured    = HGD_Subscription_Page::is_configured();
		include HGD_PATH . 'admin/views/subscriptions.php';
	}

	/** Cancel a subscription at period end (Stripe), and reflect it locally. */
	public function handle_subscription_cancel() {
		$this->guard();
		$id = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		check_admin_referer( 'hgd_subscription_cancel_' . $id );

		$sub = $id ? HGD_Subscription::get( $id ) : null;
		if ( ! $sub ) {
			$this->redirect_with( 'hgd-subscriptions', array() );
		}

		$args = array();
		if ( ! empty( $sub['stripe_subscription_id'] ) ) {
			$result = HGD_Stripe::cancel_subscription( (string) $sub['stripe_subscription_id'], true );
			if ( is_wp_error( $result ) ) {
				set_transient( 'hgd_sub_error_' . get_current_user_id(), $result->get_error_message(), 60 );
				$args['cancel_error'] = 1;
			} else {
				// Webhook will confirm; record the request now for immediate feedback.
				HGD_Subscription::update( $id, array( 'canceled_at' => current_time( 'mysql' ) ) );
				$args['cancelled'] = 1;
			}
		} else {
			// Never reached Stripe — just close the local record.
			HGD_Subscription::update( $id, array( 'status' => 'canceled', 'canceled_at' => current_time( 'mysql' ) ) );
			$args['cancelled'] = 1;
		}

		$this->redirect_with( 'hgd-subscriptions', $args );
	}

	// -------------------------------------------------------------------------
	// Forms hub (tabbed: Forms / Submissions / Analytics)
	// -------------------------------------------------------------------------

	/** Shared tab bar shown on the Forms hub, Submissions and Analytics screens. */
	public static function forms_tabs( $active ) {
		$tabs = array(
			'hgd-forms'             => __( 'Forms', 'hillcroft-garden-designer' ),
			'hgd-forms-submissions' => __( 'Submissions', 'hillcroft-garden-designer' ),
			'hgd-forms-analytics'   => __( 'Analytics', 'hillcroft-garden-designer' ),
		);
		echo '<h2 class="nav-tab-wrapper">';
		foreach ( $tabs as $slug => $label ) {
			printf(
				'<a href="%s" class="nav-tab%s">%s</a>',
				esc_url( admin_url( 'admin.php?page=' . $slug ) ),
				$active === $slug ? ' nav-tab-active' : '',
				esc_html( $label )
			);
		}
		echo '</h2>';
	}

	public function render_forms_hub() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$forms     = get_posts( array(
			'post_type'      => HGDF_CPT,
			'posts_per_page' => 200,
			'post_status'    => array( 'publish', 'draft' ),
			'orderby'        => 'modified',
			'order'          => 'DESC',
		) );
		include HGD_PATH . 'admin/views/forms-hub.php';
	}

	// -------------------------------------------------------------------------
	// Google Calendar OAuth
	// -------------------------------------------------------------------------

	/** Handle the OAuth redirect back from Google on the settings screen. */
	public function maybe_handle_google_oauth() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		if ( ! isset( $_GET['page'] ) || 'hgd-settings' !== $_GET['page'] ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		if ( ! isset( $_GET['hgd_google_oauth'] ) || 'callback' !== $_GET['hgd_google_oauth'] ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}

		$args = array( 'page' => 'hgd-settings' );

		if ( isset( $_GET['error'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$args['google'] = 'denied';
		} elseif ( isset( $_GET['code'] ) ) {
			$code   = sanitize_text_field( wp_unslash( $_GET['code'] ) );
			$result = HGD_Google_Calendar::exchange_code( $code );
			$args['google'] = is_wp_error( $result ) ? 'error' : 'connected';
		} else {
			$args['google'] = 'error';
		}

		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}

	public function handle_google_disconnect() {
		$this->guard();
		check_admin_referer( 'hgd_google_disconnect' );
		HGD_Google_Calendar::disconnect();
		$this->redirect_with( 'hgd-settings', array( 'google' => 'disconnected' ) );
	}

	// -------------------------------------------------------------------------
	// Projects
	// -------------------------------------------------------------------------

	public function render_projects() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$action    = isset( $_GET['action'] ) ? sanitize_key( $_GET['action'] ) : 'list'; // phpcs:ignore WordPress.Security.NonceVerification

		if ( 'edit' === $action || 'new' === $action ) {
			$project = array();
			if ( 'edit' === $action && isset( $_GET['id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$project = HGD_Project::get( (int) $_GET['id'] );
				if ( ! $project ) {
					wp_die( esc_html__( 'Project not found.', 'hillcroft-garden-designer' ) );
				}
			}
			$clients  = HGD_Client::all();
			$assets   = ! empty( $project['id'] ) ? HGD_Project_Asset::for_project( (int) $project['id'] ) : array();
			$quotes   = ! empty( $project['id'] ) ? HGD_Quote::for_project( (int) $project['id'] ) : array();
			$proposal = ! empty( $project['id'] ) ? HGD_Proposal::for_project( (int) $project['id'] ) : null;
			$payments = $proposal ? HGD_Payment::for_proposal( (int) $proposal['id'] ) : array();
			include HGD_PATH . 'admin/views/project-form.php';
			return;
		}

		$status   = isset( $_GET['status'] ) ? sanitize_key( $_GET['status'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$search   = isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( $_GET['s'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$projects = HGD_Project::query( array( 'status' => $status, 'search' => $search ) );
		include HGD_PATH . 'admin/views/projects.php';
	}

	public function handle_save_project() {
		$this->guard();
		check_admin_referer( 'hgd_save_project' );

		$id    = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		$clean = HGD_Project::sanitise( $_POST );

		// Optionally create a new client inline.
		$new_email = isset( $_POST['new_client_email'] ) ? sanitize_email( wp_unslash( $_POST['new_client_email'] ) ) : '';
		$new_name  = isset( $_POST['new_client_name'] ) ? sanitize_text_field( wp_unslash( $_POST['new_client_name'] ) ) : '';
		if ( ! $clean['client_id'] && ( $new_name || $new_email ) ) {
			$parts             = preg_split( '/\s+/', $new_name, 2 );
			$clean['client_id'] = HGD_Client::find_or_create( array(
				'first_name' => $parts[0],
				'last_name'  => isset( $parts[1] ) ? $parts[1] : '',
				'email'      => $new_email,
			) );
		}

		if ( '' === $clean['title'] ) {
			$clean['title'] = __( 'Untitled project', 'hillcroft-garden-designer' );
		}

		if ( $id ) {
			HGD_Project::update( $id, $clean );
		} else {
			$id = HGD_Project::insert( $clean );
		}

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'updated' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Example / demo project
	// -------------------------------------------------------------------------

	/** Build the one-click example project, then open it. */
	public function handle_create_example() {
		$this->guard();
		check_admin_referer( 'hgd_create_example' );

		$project_id = HGD_Demo::create();
		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => (int) $project_id, 'example' => 'created' ) );
	}

	/** Remove only the demo-created data and return to the projects list. */
	public function handle_remove_example() {
		$this->guard();
		check_admin_referer( 'hgd_remove_example' );

		HGD_Demo::remove();
		$this->redirect_with( 'hgd-projects', array( 'example' => 'removed' ) );
	}

	public function handle_delete_project() {
		$this->guard();
		$id = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		check_admin_referer( 'hgd_delete_project_' . $id );
		if ( $id ) {
			HGD_Project::delete( $id );
		}
		$this->redirect_with( 'hgd-projects', array( 'deleted' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Consultation capture (assets + Claude sketch reading)
	// -------------------------------------------------------------------------

	public function handle_upload_assets() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_upload_assets_' . $id );

		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$role  = isset( $_POST['role'] ) ? sanitize_key( wp_unslash( $_POST['role'] ) ) : 'photo';
		$count = 0;
		$error = '';

		if ( $id && ! empty( $_FILES['files'] ) && is_array( $_FILES['files']['name'] ) ) {
			$files = $_FILES['files'];
			$total = count( $files['name'] );
			for ( $i = 0; $i < $total; $i++ ) {
				if ( empty( $files['name'][ $i ] ) ) {
					continue;
				}
				$_FILES['hgd_asset'] = array(
					'name'     => $files['name'][ $i ],
					'type'     => $files['type'][ $i ],
					'tmp_name' => $files['tmp_name'][ $i ],
					'error'    => $files['error'][ $i ],
					'size'     => $files['size'][ $i ],
				);
				$attachment_id = media_handle_upload( 'hgd_asset', 0 );
				if ( is_wp_error( $attachment_id ) ) {
					$error = $attachment_id->get_error_message();
					continue;
				}
				HGD_Project_Asset::add( $id, $attachment_id, $role );
				$count++;
			}
			unset( $_FILES['hgd_asset'] );
		}

		$args = array( 'action' => 'edit', 'id' => $id, 'uploaded' => $count );
		if ( '' !== $error && 0 === $count ) {
			set_transient( 'hgd_upload_error_' . get_current_user_id(), $error, 60 );
			$args['upload_error'] = 1;
		}
		$this->redirect_with( 'hgd-projects', $args );
	}

	public function handle_delete_asset() {
		$this->guard();
		$asset_id = isset( $_GET['asset_id'] ) ? (int) $_GET['asset_id'] : 0;
		check_admin_referer( 'hgd_delete_asset_' . $asset_id );
		$project_id = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		if ( $asset_id ) {
			HGD_Project_Asset::delete( $asset_id );
		}
		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $project_id, 'asset_deleted' => 1 ) );
	}

	public function handle_claude_read() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_claude_read_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Claude::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'claude_error' => 'nokey' ) );
		}

		// Only the designer's uploads — sketches & photos — never the generated
		// concept renders / render-pack images.
		$assets = array_values( array_filter(
			HGD_Project_Asset::for_project( $id ),
			function ( $a ) {
				return in_array( ( isset( $a['role'] ) ? $a['role'] : '' ), array( 'sketch', 'photo', 'other' ), true );
			}
		) );
		// Sketches first, then photos/other.
		usort( $assets, function ( $a, $b ) {
			$wa = 'sketch' === $a['role'] ? 0 : 1;
			$wb = 'sketch' === $b['role'] ? 0 : 1;
			if ( $wa === $wb ) {
				return (int) $a['id'] - (int) $b['id'];
			}
			return $wa - $wb;
		} );

		if ( empty( $assets ) ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'claude_error' => 'noassets' ) );
		}

		$pets     = ! empty( $project['has_pets'] ) ? 'yes' : 'no';
		$children = ! empty( $project['has_children'] ) ? 'yes' : 'no';

		$prompt  = "Here is the consultation brief for a garden design project. Read the attached hand-drawn sketch(es) and any photos.\n\n";
		$prompt .= 'Address: ' . ( $project['address'] ?: '(not given)' ) . "\n";
		$prompt .= 'Postcode: ' . ( $project['postcode'] ?: '(not given)' ) . "\n";
		$prompt .= 'Budget range: ' . ( $project['budget_range'] ?: '(not given)' ) . "\n";
		$prompt .= 'Style preferences: ' . ( $project['style_prefs'] ?: '(not given)' ) . "\n";
		$prompt .= 'Pets at home: ' . $pets . "\n";
		$prompt .= 'Children at home: ' . $children . "\n";
		$prompt .= "Brief / notes:\n" . ( $project['brief_notes'] ?: '(none)' ) . "\n";

		$blocks = array( HGD_Claude::text_block( $prompt ) );
		foreach ( $assets as $asset ) {
			$block = HGD_Claude::image_block_from_attachment( (int) $asset['attachment_id'] );
			if ( $block ) {
				$blocks[] = $block;
			}
		}

		$system = 'You are an expert garden-design assistant helping a professional garden designer. '
			. 'You are given images from a site consultation: one or more hand-drawn garden sketches AND photographs of the existing garden. '
			. 'Use the SKETCH for the intended layout and READ any hand-written dimensions, measurements and annotations on it. '
			. 'Use the PHOTOGRAPHS for real-world context — cross-reference them with the sketch to understand the existing garden: '
			. 'levels and slopes, boundaries (walls/fences/hedges), aspect and light, surfaces, and existing trees, shrubs and plants '
			. '(note which look established or worth keeping). Build one coherent picture of the site from the sketch and photos together. '
			. 'Identify zones and features: beds, borders, lawn, patio, decking, paths, walls, fences, steps, water features, '
			. 'existing planting, and anything else marked or visible. '
			. 'Respond ONLY with a single JSON object with exactly two keys: '
			. '"reading" (a clear prose summary of everything you see across the sketch and photos, including all measurements you can read '
			. 'and the existing features the photos reveal), and '
			. '"questions" (an array of specific clarifying questions to confirm you have read the site correctly). '
			. 'Do not wrap the JSON in markdown fences or add any text outside the JSON object.';

		$result = HGD_Claude::message( $blocks, $system, 4000, $id );

		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_claude_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'claude_error' => 'api' ) );
		}

		$parsed = $this->parse_claude_json( $result['text'] );
		if ( null === $parsed ) {
			set_transient( 'hgd_claude_error_' . get_current_user_id(), __( 'Could not parse a JSON response from Claude.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'claude_error' => 'parse' ) );
		}

		$reading   = isset( $parsed['reading'] ) ? (string) $parsed['reading'] : '';
		$questions = isset( $parsed['questions'] ) && is_array( $parsed['questions'] ) ? array_values( $parsed['questions'] ) : array();

		HGD_Project::update( $id, array(
			'ai_reading'   => wp_kses_post( $reading ),
			'ai_questions' => wp_json_encode( array_map( 'sanitize_text_field', $questions ) ),
		) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'claude_read' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Structured measurements + draw-on-plan tool
	// -------------------------------------------------------------------------

	/**
	 * Save the structured site measurements (plot dimensions + zones).
	 *
	 * Accepts either the canvas's serialised hidden JSON field
	 * (measurements_json) or the manual table fields. Whichever is present, the
	 * data is re-built from known keys + clamped by HGD_Measure::save() — the
	 * posted JSON is never trusted blindly.
	 */
	public function handle_save_measurements() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_save_measurements_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		$data = null;

		// 1) Prefer the canvas JSON when present and decodable.
		if ( isset( $_POST['measurements_json'] ) && '' !== trim( (string) wp_unslash( $_POST['measurements_json'] ) ) ) {
			$decoded = json_decode( wp_unslash( $_POST['measurements_json'] ), true );
			if ( is_array( $decoded ) ) {
				$data = $decoded;
			}
		}

		// 2) Otherwise build from the manual table fields.
		if ( null === $data ) {
			$data = array(
				'plot'       => array(
					'w' => isset( $_POST['plot_w'] ) ? (float) wp_unslash( $_POST['plot_w'] ) : 0,
					'l' => isset( $_POST['plot_l'] ) ? (float) wp_unslash( $_POST['plot_l'] ) : 0,
				),
				'scale_note' => isset( $_POST['scale_note'] ) ? sanitize_text_field( wp_unslash( $_POST['scale_note'] ) ) : '',
				'zones'      => array(),
			);

			if ( isset( $_POST['zone_label'] ) && is_array( $_POST['zone_label'] ) ) {
				$labels = (array) wp_unslash( $_POST['zone_label'] );
				$types  = isset( $_POST['zone_type'] ) ? (array) wp_unslash( $_POST['zone_type'] ) : array();
				$ws     = isset( $_POST['zone_w'] ) ? (array) wp_unslash( $_POST['zone_w'] ) : array();
				$ls     = isset( $_POST['zone_l'] ) ? (array) wp_unslash( $_POST['zone_l'] ) : array();
				$areas  = isset( $_POST['zone_area'] ) ? (array) wp_unslash( $_POST['zone_area'] ) : array();

				foreach ( $labels as $k => $label ) {
					$data['zones'][] = array(
						'label'   => (string) $label,
						'type'    => isset( $types[ $k ] ) ? (string) $types[ $k ] : 'other',
						'w'       => isset( $ws[ $k ] ) ? (float) $ws[ $k ] : 0,
						'l'       => isset( $ls[ $k ] ) ? (float) $ls[ $k ] : 0,
						'area_m2' => isset( $areas[ $k ] ) ? (float) $areas[ $k ] : 0,
					);
				}
			}
		}

		HGD_Measure::save( $id, is_array( $data ) ? $data : array() );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'measure_saved' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Capture chat (Claude Q&A that auto-updates the design brief)
	// -------------------------------------------------------------------------

	/** Send a designer reply to Claude; it answers and returns an updated design brief. */
	public function handle_chat_send() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_chat_send_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Claude::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_error' => 'nokey' ) );
		}

		$message = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';
		if ( '' === trim( $message ) ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_error' => 'empty' ) );
		}

		// 1. Save the user message.
		HGD_Chat::add( $id, 'user', $message );

		// 2. Build the Claude call context.
		$current_brief = '' !== (string) $project['design_brief'] ? (string) $project['design_brief'] : (string) $project['brief_notes'];

		$prompt  = "CONSULTATION READING (Claude's earlier interpretation of the site sketch):\n" . ( $project['ai_reading'] ?: '(none)' ) . "\n\n";
		$prompt .= "CURRENT DESIGN BRIEF:\n" . ( '' !== trim( $current_brief ) ? $current_brief : '(none yet)' ) . "\n\n";

		$prompt .= "CONVERSATION SO FAR:\n";
		$transcript = HGD_Chat::messages( $id );
		if ( empty( $transcript ) ) {
			$prompt .= "(none)\n";
		} else {
			foreach ( $transcript as $turn ) {
				$who     = ( 'assistant' === $turn['role'] ) ? 'assistant' : 'designer';
				$prompt .= $who . ': ' . (string) $turn['body'] . "\n";
			}
		}
		$prompt .= "\nNEW DESIGNER MESSAGE:\n" . $message . "\n";

		$system = 'You are an expert garden-design assistant helping the designer turn an on-site consultation into a clear design brief. '
			. 'You have already read the sketch. The designer is answering your clarifying questions. After each reply: '
			. '(a) respond briefly and conversationally, and (b) produce an updated, polished design brief incorporating everything known so far. '
			. 'Return STRICT JSON: {"reply":"…","brief":"…"}.';

		$result = HGD_Claude::message( array( HGD_Claude::text_block( $prompt ) ), $system, 4000, $id );

		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_chat_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_error' => 'api' ) );
		}

		$parsed = $this->parse_claude_json( $result['text'] );
		if ( null === $parsed ) {
			set_transient( 'hgd_chat_error_' . get_current_user_id(), __( 'Could not parse a JSON response from Claude.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_error' => 'parse' ) );
		}

		$reply = isset( $parsed['reply'] ) ? (string) $parsed['reply'] : '';
		$brief = isset( $parsed['brief'] ) ? (string) $parsed['brief'] : '';

		// 3. Save the assistant reply and (if present) auto-update the design brief.
		HGD_Chat::add( $id, 'assistant', wp_kses_post( $reply ) );
		if ( '' !== trim( $brief ) ) {
			HGD_Project::update( $id, array( 'design_brief' => sanitize_textarea_field( $brief ) ) );
		}

		// 4. Back to the capture step with a success flash.
		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_sent' => 1 ) );
	}

	/** Reset the capture chat thread for a project. */
	public function handle_chat_clear() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_chat_clear_' . $id );

		if ( $id ) {
			HGD_Chat::clear( $id );
		}
		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'capture', 'chat_cleared' => 1 ) );
	}

	/** Tolerant JSON extraction: grab the first {...} block and decode it. */
	private function parse_claude_json( $text ) {
		$text = trim( (string) $text );
		if ( '' === $text ) {
			return null;
		}

		// Strip ```json … ``` / ``` … ``` markdown fences if present.
		if ( 0 === strpos( $text, '```' ) ) {
			$text = preg_replace( '/^```[a-zA-Z]*\s*/', '', $text );
			$text = preg_replace( '/```\s*$/', '', $text );
			$text = trim( $text );
		}

		// 1) Strict decode.
		$decoded = json_decode( $text, true );
		if ( is_array( $decoded ) ) {
			return $decoded;
		}

		// 2) Decode the outermost { … } block.
		$start = strpos( $text, '{' );
		$end   = strrpos( $text, '}' );
		if ( false !== $start && false !== $end && $end > $start ) {
			$candidate = substr( $text, $start, $end - $start + 1 );
			$decoded   = json_decode( $candidate, true );
			if ( is_array( $decoded ) ) {
				return $decoded;
			}
		}

		// 3) Salvage: the JSON was likely truncated (token limit) or lightly
		// malformed. Pull out the fields directly so the user still gets a result.
		$salvaged = array();

		// "reading": "...." — capture up to the next unescaped quote that closes
		// the value, or to the end of the string if truncated.
		if ( preg_match( '/"reading"\s*:\s*"(.*?)(?<!\\\\)"\s*(?:,\s*"questions"|}|$)/s', $text, $m ) ) {
			$salvaged['reading'] = self::unescape_json_fragment( $m[1] );
		} elseif ( preg_match( '/"reading"\s*:\s*"(.*)$/s', $text, $m ) ) {
			// Truncated mid-reading — take what we have.
			$salvaged['reading'] = self::unescape_json_fragment( rtrim( $m[1], '"\\' ) );
		}

		// "questions": [ "...", "..." ] — grab the array body and pull strings.
		if ( preg_match( '/"questions"\s*:\s*\[(.*?)(?:\]|$)/s', $text, $m ) ) {
			$qs = array();
			if ( preg_match_all( '/"((?:[^"\\\\]|\\\\.)*)"/s', $m[1], $qm ) ) {
				foreach ( $qm[1] as $q ) {
					$q = self::unescape_json_fragment( $q );
					if ( '' !== trim( $q ) ) {
						$qs[] = $q;
					}
				}
			}
			$salvaged['questions'] = $qs;
		}

		if ( ! empty( $salvaged['reading'] ) || ! empty( $salvaged['questions'] ) ) {
			return $salvaged;
		}

		return null;
	}

	/** Best-effort unescape of a JSON string fragment pulled out by regex. */
	private static function unescape_json_fragment( $s ) {
		$decoded = json_decode( '"' . $s . '"' );
		if ( is_string( $decoded ) ) {
			return $decoded;
		}
		return str_replace(
			array( '\\"', '\\n', '\\r', '\\t', '\\/', '\\\\' ),
			array( '"', "\n", "\r", "\t", '/', '\\' ),
			$s
		);
	}

	// -------------------------------------------------------------------------
	// Design brief + render prompt (Claude-assisted) and Gemini concept renders
	// -------------------------------------------------------------------------

	/** Save the hand-editable design brief + render prompt textareas. */
	public function handle_save_design() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_save_design_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		$design_brief  = isset( $_POST['design_brief'] ) ? sanitize_textarea_field( wp_unslash( $_POST['design_brief'] ) ) : '';
		$render_prompt = isset( $_POST['render_prompt'] ) ? sanitize_textarea_field( wp_unslash( $_POST['render_prompt'] ) ) : '';

		HGD_Project::update( $id, array(
			'design_brief'  => $design_brief,
			'render_prompt' => $render_prompt,
		) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'design_saved' => 1 ) );
	}

	/** Ask Claude to compose a design brief + image-generation prompt. */
	public function handle_compose_prompt() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_compose_prompt_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Claude::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'design_error' => 'nokey' ) );
		}

		$ideas = '' !== (string) $project['design_brief'] ? (string) $project['design_brief'] : (string) $project['brief_notes'];

		$prompt  = "Consultation reading (Claude's interpretation of the site sketch):\n" . ( $project['ai_reading'] ?: '(none)' ) . "\n\n";
		$prompt .= "Designer's ideas / brief notes:\n" . ( $ideas ?: '(none)' ) . "\n\n";
		$prompt .= 'Style preferences: ' . ( $project['style_prefs'] ?: '(not given)' ) . "\n";
		$prompt .= 'Budget range: ' . ( $project['budget_range'] ?: '(not given)' ) . "\n";
		$prompt .= 'Address: ' . ( $project['address'] ?: '(not given)' ) . "\n";
		$prompt .= 'Postcode: ' . ( $project['postcode'] ?: '(not given)' ) . "\n";

		$system = 'You are a garden-design assistant. Using the consultation reading and the designer\'s ideas, '
			. 'write (a) a concise design brief and (b) a single richly-detailed image-generation prompt for a photorealistic '
			. 'garden concept render — describe layout, planting, materials, mood, season, viewpoint; keep fixed features consistent. '
			. 'Respond ONLY with a single JSON object with exactly two keys: "brief" (the concise design brief) and '
			. '"prompt" (the single image-generation prompt). Do not wrap the JSON in markdown fences or add any text outside the JSON object.';

		$result = HGD_Claude::message( array( HGD_Claude::text_block( $prompt ) ), $system, 4000, $id );

		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_design_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'design_error' => 'api' ) );
		}

		$parsed = $this->parse_claude_json( $result['text'] );
		if ( null === $parsed ) {
			set_transient( 'hgd_design_error_' . get_current_user_id(), __( 'Could not parse a JSON response from Claude.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'design_error' => 'parse' ) );
		}

		$brief         = isset( $parsed['brief'] ) ? (string) $parsed['brief'] : '';
		$render_prompt = isset( $parsed['prompt'] ) ? (string) $parsed['prompt'] : '';

		HGD_Project::update( $id, array(
			'design_brief'  => sanitize_textarea_field( $brief ),
			'render_prompt' => sanitize_textarea_field( $render_prompt ),
		) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'design_composed' => 1 ) );
	}

	/** Generate (or iterate) a Gemini concept render and append it to the gallery. */
	public function handle_generate_render() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_generate_render_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'render_error' => 'nokey' ) );
		}

		$prompt = (string) $project['render_prompt'];
		if ( '' === trim( $prompt ) ) {
			$prompt = (string) $project['design_brief'];
		}
		if ( '' === trim( $prompt ) ) {
			$prompt = 'A beautifully designed residential garden, lush layered planting and well-considered materials, well composed.';
		}
		// Apply the chosen render aesthetic (watercolour by default).
		$prompt .= "\n\n" . HGD_Settings::render_style_suffix();

		// Anchor the render to the approved PLAN first, then concept render, then
		// sketch (see HGD_Render_Pack::reference_ids_for) — so renders follow the
		// real, agreed layout rather than inventing one.
		$refs = HGD_Render_Pack::reference_ids_for( $id );

		$result = HGD_Gemini::generate_image( $prompt, $refs, $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'render_error' => 'api' ) );
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $id, 'concept' );
		if ( is_wp_error( $att_id ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $att_id->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'render_error' => 'save' ) );
		}

		HGD_Project_Asset::add( $id, $att_id, 'render' );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'render_done' => 1 ) );
	}

	/**
	 * Generate a render by designing the scheme INTO one of the client's real
	 * site photos (photo-inpainting mode): same viewpoint, house and boundaries,
	 * only the garden is redesigned. The chosen photo is the primary reference.
	 */
	public function handle_generate_photo_render() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_generate_photo_render_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'nokey' ) );
		}

		// The chosen base photo must be one of THIS project's uploaded photos.
		$base_id  = isset( $_POST['base_photo_id'] ) ? (int) $_POST['base_photo_id'] : 0;
		$base_ok  = false;
		foreach ( HGD_Project_Asset::for_project( $id ) as $a ) {
			if ( (int) $a['attachment_id'] === $base_id
				&& in_array( ( isset( $a['role'] ) ? $a['role'] : '' ), array( 'photo', 'other' ), true ) ) {
				$base_ok = true;
				break;
			}
		}
		if ( ! $base_id || ! $base_ok ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'nophoto' ) );
		}

		$prompt = HGD_Render_Pack::compose_photo_prompt( $project );

		// The base photo leads (so the model edits it in place); the approved plan,
		// if any, follows as a layout guide.
		$refs  = array( $base_id );
		$plans = HGD_Project_Asset::for_project( $id, 'plan' );
		if ( ! empty( $plans ) ) {
			$latest = end( $plans );
			if ( ! empty( $latest['attachment_id'] ) ) {
				$refs[] = (int) $latest['attachment_id'];
			}
		}

		$result = HGD_Gemini::generate_image( $prompt, $refs, $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'api' ) );
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $id, 'photo-render' );
		if ( is_wp_error( $att_id ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $att_id->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'save' ) );
		}

		HGD_Project_Asset::add( $id, $att_id, 'render', 'photo_render', __( 'Designed into site photo', 'hillcroft-garden-designer' ) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_done' => 1 ) );
	}

	/**
	 * Generate a render with the optional Flux + ControlNet engine (fal.ai),
	 * using the approved plan (or sketch) as a structural guide so the layout
	 * is followed exactly. Only available when a fal.ai key is configured.
	 */
	public function handle_generate_flux_render() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_generate_flux_render_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Flux::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'noflux' ) );
		}

		// Structural guide: the most recent approved plan, else the sketch.
		$control_id = 0;
		$plans      = HGD_Project_Asset::for_project( $id, 'plan' );
		if ( ! empty( $plans ) ) {
			$latest     = end( $plans );
			$control_id = (int) $latest['attachment_id'];
		} else {
			$sketches = HGD_Project_Asset::for_project( $id, 'sketch' );
			if ( ! empty( $sketches ) ) {
				$control_id = (int) $sketches[0]['attachment_id'];
			}
		}
		if ( ! $control_id ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'nocontrol' ) );
		}

		$prompt = (string) $project['render_prompt'];
		if ( '' === trim( $prompt ) ) {
			$prompt = (string) $project['design_brief'];
		}
		if ( '' === trim( $prompt ) ) {
			$prompt = 'A beautifully designed residential garden, lush layered planting and well-considered materials.';
		}
		$prompt .= "\n\n" . HGD_Settings::render_style_suffix();
		if ( class_exists( 'HGD_Measure' ) ) {
			$line = HGD_Measure::render_line( $project );
			if ( '' !== $line ) {
				$prompt .= "\n\nScale reference: " . $line;
			}
		}

		$result = HGD_Flux::generate_image( $prompt, $control_id, $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'api' ) );
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $id, 'flux-render' );
		if ( is_wp_error( $att_id ) ) {
			set_transient( 'hgd_render_error_' . get_current_user_id(), $att_id->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_error' => 'save' ) );
		}

		HGD_Project_Asset::add( $id, $att_id, 'render', 'flux_render', __( 'Structural render (Flux + ControlNet)', 'hillcroft-garden-designer' ) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'render_done' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Approval gate + render scorecard
	// -------------------------------------------------------------------------

	/**
	 * Toggle the approved "hero" render. Only an approved render (if any) is
	 * used as the downstream reference for the render pack and proposal.
	 */
	public function handle_approve_render() {
		$this->guard();
		$id       = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$asset_id = isset( $_POST['asset_id'] ) ? (int) $_POST['asset_id'] : 0;
		check_admin_referer( 'hgd_approve_render_' . $asset_id );

		$row = $asset_id ? HGD_Project_Asset::get( $asset_id ) : null;
		if ( ! $id || ! $row || (int) $row['project_id'] !== $id || 'render' !== $row['role'] ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders' ) );
		}

		$state = HGD_Project_Asset::toggle_approved( $asset_id, $id );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'approved' => ( 'approved' === $state ? 1 : 0 ) ) );
	}

	/**
	 * Score a render against the brief, reading and measurements using Claude
	 * vision — a 0–100 match score plus what matches and what's off. Stored on
	 * the render so a render that ignored the brief is caught before the client.
	 */
	public function handle_score_render() {
		$this->guard();
		$id       = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$asset_id = isset( $_POST['asset_id'] ) ? (int) $_POST['asset_id'] : 0;
		check_admin_referer( 'hgd_score_render_' . $asset_id );

		$project = $id ? HGD_Project::get( $id ) : null;
		$row     = $asset_id ? HGD_Project_Asset::get( $asset_id ) : null;
		if ( ! $project || ! $row || (int) $row['project_id'] !== $id || 'render' !== $row['role'] ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders' ) );
		}

		if ( ! HGD_Claude::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'score_error' => 'nokey' ) );
		}

		$measure = class_exists( 'HGD_Measure' ) ? HGD_Measure::summary_text( $project ) : '';

		$context  = "DESIGN BRIEF (the intended scheme):\n" . ( $project['design_brief'] ?: '(none)' ) . "\n\n";
		$context .= "SITE READING (existing garden, dimensions, features):\n" . ( $project['ai_reading'] ?: '(none)' ) . "\n\n";
		$context .= 'MEASUREMENTS: ' . ( '' !== $measure ? $measure : '(none captured)' ) . "\n\n";
		$context .= "RENDER PROMPT used:\n" . ( $project['render_prompt'] ?: '(none)' );

		$system = 'You are a senior garden designer doing QA on an AI-generated concept render before it goes to the client. '
			. 'You are given the design brief, the site reading, the measured dimensions and the attached render image. '
			. 'Judge HOW WELL THE RENDER MATCHES THE BRIEF AND THE REAL SITE: layout and zones, planting palette and density, '
			. 'hard-landscaping and materials, boundaries and fixed features, and whether proportions look true to the measurements. '
			. 'Be specific and honest — flag anything invented, missing or contradicting the brief. '
			. 'Respond ONLY with a single JSON object with exactly these keys: '
			. '"score" (integer 0-100, how faithfully it realises the brief on the real site), '
			. '"verdict" (one short sentence), '
			. '"matches" (array of short strings — what it gets right), '
			. '"mismatches" (array of short strings — what is off, missing or invented). '
			. 'Do not wrap the JSON in markdown fences or add any text outside the JSON object.';

		$blocks = array(
			HGD_Claude::text_block( $context ),
		);
		$img = HGD_Claude::image_block_from_attachment( (int) $row['attachment_id'] );
		if ( $img ) {
			$blocks[] = $img;
		}

		$result = HGD_Claude::message( $blocks, $system, 1500, $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_score_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'score_error' => 'api' ) );
		}

		$parsed = $this->parse_claude_json( $result['text'] );
		if ( ! is_array( $parsed ) ) {
			set_transient( 'hgd_score_error_' . get_current_user_id(), __( 'Could not read the scorecard from Claude. Try again.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'score_error' => 'parse' ) );
		}

		$score  = isset( $parsed['score'] ) ? (int) $parsed['score'] : 0;
		$review = array(
			'verdict'    => isset( $parsed['verdict'] ) ? sanitize_text_field( (string) $parsed['verdict'] ) : '',
			'matches'    => array_map( 'sanitize_text_field', isset( $parsed['matches'] ) && is_array( $parsed['matches'] ) ? $parsed['matches'] : array() ),
			'mismatches' => array_map( 'sanitize_text_field', isset( $parsed['mismatches'] ) && is_array( $parsed['mismatches'] ) ? $parsed['mismatches'] : array() ),
		);

		HGD_Project_Asset::save_review( $asset_id, $score, $review );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'renders', 'scored' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Plan-first pipeline (top-down garden PLAN drawing, iterated, then used as
	// the structural reference for renders and the render pack)
	// -------------------------------------------------------------------------

	/** Save the hand-editable plan prompt textarea. */
	public function handle_save_plan_prompt() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_save_plan_prompt_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		$plan_prompt = isset( $_POST['plan_prompt'] ) ? sanitize_textarea_field( wp_unslash( $_POST['plan_prompt'] ) ) : '';

		HGD_Project::update( $id, array( 'plan_prompt' => $plan_prompt ) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_saved' => 1 ) );
	}

	/** Ask Claude to draft a good plan prompt from the site reading + design brief. */
	public function handle_compose_plan_prompt() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_compose_plan_prompt_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Claude::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'nokey' ) );
		}

		$prompt  = "Consultation reading (Claude's interpretation of the site sketch, including dimensions):\n" . ( $project['ai_reading'] ?: '(none)' ) . "\n\n";
		$prompt .= "Design brief (the intended scheme):\n" . ( $project['design_brief'] ?: '(none)' ) . "\n\n";
		$prompt .= 'Style preferences: ' . ( $project['style_prefs'] ?: '(not given)' ) . "\n";
		$prompt .= 'Address: ' . ( $project['address'] ?: '(not given)' ) . "\n";
		$prompt .= 'Postcode: ' . ( $project['postcode'] ?: '(not given)' ) . "\n";

		$system = 'You are a garden-design assistant. Using the site reading and design brief, write a single richly-detailed '
			. 'image-generation prompt for a CLEAN, TOP-DOWN, SCALED GARDEN PLAN drawing — an architectural / landscape-plan style '
			. 'bird\'s-eye orthographic view (NOT a photoreal render). The prompt must call for: a crisp plan view from directly above, '
			. 'a north arrow, labelled zones (lawn, borders/beds, patio/terrace, paths, steps, structures, existing trees), clear bed outlines, '
			. 'simple plant-massing blobs with a light legend, and a hand-drawn-but-precise ink-and-wash aesthetic on white. '
			. 'It must explicitly tell the model to honour the real dimensions and layout from the reading and keep fixed features in place. '
			. 'Respond ONLY with a single JSON object with exactly one key: "prompt" (the plan image-generation prompt). '
			. 'Do not wrap the JSON in markdown fences or add any text outside the JSON object.';

		$result = HGD_Claude::message( array( HGD_Claude::text_block( $prompt ) ), $system, 4000, $id );

		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_plan_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'api' ) );
		}

		$parsed = $this->parse_claude_json( $result['text'] );
		if ( null === $parsed ) {
			set_transient( 'hgd_plan_error_' . get_current_user_id(), __( 'Could not parse a JSON response from Claude.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'parse' ) );
		}

		$plan_prompt = isset( $parsed['prompt'] ) ? (string) $parsed['prompt'] : '';

		HGD_Project::update( $id, array( 'plan_prompt' => sanitize_textarea_field( $plan_prompt ) ) );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_composed' => 1 ) );
	}

	/** Generate (or iterate) a top-down garden plan drawing from the sketch + notes. */
	public function handle_generate_plan() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_generate_plan_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'nokey' ) );
		}

		$prompt = isset( $project['plan_prompt'] ) ? trim( (string) $project['plan_prompt'] ) : '';
		if ( '' === $prompt ) {
			$prompt = HGD_Plan::compose_plan_prompt( $project );
		}

		// Build the plan FROM the real sketch(es), topped up with photos.
		$refs = HGD_Plan::reference_ids_for( $id );

		$result = HGD_Gemini::generate_image( $prompt, $refs, $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_plan_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'api' ) );
		}

		$att_id = HGD_Gemini::save_image_as_attachment( $result['bytes'], $result['mime'], $id, 'plan' );
		if ( is_wp_error( $att_id ) ) {
			set_transient( 'hgd_plan_error_' . get_current_user_id(), $att_id->get_error_message(), 120 );
			$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_error' => 'save' ) );
		}

		HGD_Project_Asset::add( $id, $att_id, 'plan' );

		$this->redirect_with( 'hgd-projects', array( 'action' => 'edit', 'id' => $id, 'step' => 'plan', 'plan_done' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Render pack (deliberate set of named views, anchored to the approved plan
	// / concept render)
	// -------------------------------------------------------------------------

	/** Redirect back to a project's Render pack panel with optional flash flags. */
	private function pack_redirect( $pid, array $args = array() ) {
		$this->redirect_with( 'hgd-projects', array_merge(
			array( 'action' => 'edit', 'id' => (int) $pid ),
			$args
		) );
	}

	/** Generate one named pack view, for an optional season. */
	public function handle_pack_generate_view() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_pack_generate_view_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'nokey' ) );
		}

		$view_key = isset( $_POST['view_key'] ) ? sanitize_key( wp_unslash( $_POST['view_key'] ) ) : '';
		$season   = isset( $_POST['season'] ) ? sanitize_key( wp_unslash( $_POST['season'] ) ) : HGD_Render_Pack::DEFAULT_SEASON;
		if ( ! isset( HGD_Render_Pack::VIEWS[ $view_key ] ) ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'badview' ) );
		}

		$result = HGD_Render_Pack::generate_view( $id, $view_key, $season, HGD_Render_Pack::reference_ids_for( $id ) );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_pack_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->pack_redirect( $id, array( 'pack_error' => 'api' ) );
		}

		$this->pack_redirect( $id, array( 'pack_done' => 1 ) );
	}

	/** Generate the full core set of pack views for the default season (skipping any that exist). */
	public function handle_pack_generate_all() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_pack_generate_all_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'nokey' ) );
		}

		// Generating ~6 images can take a while; lift the time limit where allowed.
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}

		$season    = HGD_Render_Pack::DEFAULT_SEASON;
		$refs      = HGD_Render_Pack::reference_ids_for( $id );
		$generated = 0;
		$skipped   = 0;
		$failed    = 0;
		$last_err  = '';

		foreach ( array_keys( HGD_Render_Pack::VIEWS ) as $view_key ) {
			if ( HGD_Render_Pack::view_exists( $id, $view_key, $season ) ) {
				$skipped++;
				continue;
			}
			$result = HGD_Render_Pack::generate_view( $id, $view_key, $season, $refs );
			if ( is_wp_error( $result ) ) {
				$failed++;
				$last_err = $result->get_error_message();
				continue;
			}
			$generated++;
		}

		if ( '' !== $last_err ) {
			set_transient( 'hgd_pack_error_' . get_current_user_id(), $last_err, 120 );
		}

		$this->pack_redirect( $id, array(
			'pack_all'      => 1,
			'pack_gen'      => $generated,
			'pack_skip'     => $skipped,
			'pack_fail'     => $failed,
		) );
	}

	/** Generate one chosen view across all four seasons (skipping any that exist). */
	public function handle_pack_seasonal() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_pack_seasonal_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Gemini::is_configured() ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'nokey' ) );
		}

		$view_key = isset( $_POST['view_key'] ) ? sanitize_key( wp_unslash( $_POST['view_key'] ) ) : '';
		if ( ! isset( HGD_Render_Pack::VIEWS[ $view_key ] ) ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'badview' ) );
		}

		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}

		$refs      = HGD_Render_Pack::reference_ids_for( $id );
		$generated = 0;
		$skipped   = 0;
		$failed    = 0;
		$last_err  = '';

		foreach ( array_keys( HGD_Render_Pack::SEASONS ) as $season ) {
			if ( HGD_Render_Pack::view_exists( $id, $view_key, $season ) ) {
				$skipped++;
				continue;
			}
			$result = HGD_Render_Pack::generate_view( $id, $view_key, $season, $refs );
			if ( is_wp_error( $result ) ) {
				$failed++;
				$last_err = $result->get_error_message();
				continue;
			}
			$generated++;
		}

		if ( '' !== $last_err ) {
			set_transient( 'hgd_pack_error_' . get_current_user_id(), $last_err, 120 );
		}

		$this->pack_redirect( $id, array(
			'pack_all'  => 1,
			'pack_gen'  => $generated,
			'pack_skip' => $skipped,
			'pack_fail' => $failed,
		) );
	}

	/** Fetch the real satellite photo of the plot and add it as a pack view. */
	public function handle_pack_fetch_satellite() {
		$this->guard();
		$id = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_pack_fetch_satellite_' . $id );

		$project = $id ? HGD_Project::get( $id ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		if ( ! HGD_Maps::is_configured() ) {
			$this->pack_redirect( $id, array( 'pack_error' => 'nomaps' ) );
		}

		$result = HGD_Maps::save_satellite_asset( $id );
		if ( is_wp_error( $result ) ) {
			set_transient( 'hgd_pack_error_' . get_current_user_id(), $result->get_error_message(), 120 );
			$this->pack_redirect( $id, array( 'pack_error' => 'maps' ) );
		}

		$this->pack_redirect( $id, array( 'pack_satellite' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Clients
	// -------------------------------------------------------------------------

	public function render_clients() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$action    = isset( $_GET['action'] ) ? sanitize_key( $_GET['action'] ) : 'list'; // phpcs:ignore WordPress.Security.NonceVerification

		if ( 'edit' === $action || 'new' === $action ) {
			$client = array();
			if ( 'edit' === $action && isset( $_GET['id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$client = HGD_Client::get( (int) $_GET['id'] );
				if ( ! $client ) {
					wp_die( esc_html__( 'Client not found.', 'hillcroft-garden-designer' ) );
				}
			}
			include HGD_PATH . 'admin/views/client-form.php';
			return;
		}

		$clients = HGD_Client::all();
		include HGD_PATH . 'admin/views/clients.php';
	}

	public function handle_save_client() {
		$this->guard();
		check_admin_referer( 'hgd_save_client' );

		$id    = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		$clean = HGD_Client::sanitise( $_POST );

		if ( '' === $clean['first_name'] && '' === $clean['last_name'] && '' === $clean['email'] ) {
			$this->redirect_with( 'hgd-clients', array( 'action' => $id ? 'edit' : 'new', 'id' => $id ?: null, 'error' => 'empty' ) );
		}

		if ( $id ) {
			HGD_Client::update( $id, $clean );
		} else {
			$id = HGD_Client::insert( $clean );
		}

		$this->redirect_with( 'hgd-clients', array( 'updated' => 1 ) );
	}

	public function handle_delete_client() {
		$this->guard();
		$id = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		check_admin_referer( 'hgd_delete_client_' . $id );
		if ( $id ) {
			HGD_Client::delete( $id );
		}
		$this->redirect_with( 'hgd-clients', array( 'deleted' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Pricing engine (quotes + line items)
	// -------------------------------------------------------------------------

	/** Redirect back to a project's Pricing tab with optional flash flags. */
	private function pricing_redirect( $pid, array $args = array() ) {
		$this->redirect_with( 'hgd-projects', array_merge(
			array( 'action' => 'edit', 'id' => (int) $pid, 'tab' => 'pricing' ),
			$args
		) );
	}

	/** Create the three tier quotes (Good / Better / Best) for a project. */
	public function handle_quote_init() {
		$this->guard();
		$pid = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_quote_init_' . $pid );

		$project = $pid ? HGD_Project::get( $pid ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		HGD_Quote::ensure_tiers( $pid );
		$this->pricing_redirect( $pid, array( 'quote_init' => 1 ) );
	}

	/** Save a quote's settings fields (labour days, day rate, %s, fees, VAT). */
	public function handle_quote_save() {
		$this->guard();
		$pid      = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		check_admin_referer( 'hgd_quote_save_' . $quote_id );

		if ( ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$clean = HGD_Quote::sanitise_settings( wp_unslash( $_POST ) );
		HGD_Quote::update( $quote_id, $clean );
		$this->pricing_redirect( $pid, array( 'quote_saved' => 1 ) );
	}

	/** Add a manual line item to a quote. */
	public function handle_quote_add_item() {
		$this->guard();
		$pid      = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		check_admin_referer( 'hgd_quote_add_item_' . $quote_id );

		if ( ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$clean = HGD_Quote::sanitise_item( $_POST );
		if ( '' === $clean['label'] ) {
			$clean['label'] = HGD_Quote::item_type_label( $clean['item_type'] );
		}
		HGD_Quote::add_item( $quote_id, $clean );
		$this->pricing_redirect( $pid, array( 'item_added' => 1 ) );
	}

	/** Add a plant from the catalogue to a quote. */
	public function handle_quote_add_plant() {
		$this->guard();
		$pid      = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		check_admin_referer( 'hgd_quote_add_plant_' . $quote_id );

		if ( ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$plant_id = isset( $_POST['plant_id'] ) ? (int) $_POST['plant_id'] : 0;
		$qty      = isset( $_POST['qty'] ) ? round( (float) $_POST['qty'], 2 ) : 1;
		if ( $qty <= 0 ) {
			$qty = 1;
		}
		if ( ! $plant_id ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$added = HGD_Quote::add_plant( $quote_id, $plant_id, $qty );
		$this->pricing_redirect( $pid, array( $added ? 'plant_added' : 'quote_error' => 1 ) );
	}

	/** Edit an existing line item. */
	public function handle_quote_update_item() {
		$this->guard();
		$pid      = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		$item_id  = isset( $_POST['item_id'] ) ? (int) $_POST['item_id'] : 0;
		check_admin_referer( 'hgd_quote_update_item_' . $item_id );

		if ( ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) || ! HGD_Quote::item_belongs_to_quote( $item_id, $quote_id ) ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$clean = HGD_Quote::sanitise_item( $_POST );
		HGD_Quote::update_item( $item_id, $clean );
		$this->pricing_redirect( $pid, array( 'item_saved' => 1 ) );
	}

	/** Remove a line item. */
	public function handle_quote_delete_item() {
		$this->guard();
		$pid      = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		$item_id  = isset( $_POST['item_id'] ) ? (int) $_POST['item_id'] : 0;
		check_admin_referer( 'hgd_quote_delete_item_' . $item_id );

		if ( ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) || ! HGD_Quote::item_belongs_to_quote( $item_id, $quote_id ) ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		HGD_Quote::delete_item( $item_id );
		$this->pricing_redirect( $pid, array( 'item_deleted' => 1 ) );
	}

	/** Seed Better & Best from the Good quote using the uplift settings. */
	public function handle_quote_seed_tiers() {
		$this->guard();
		$pid = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_quote_seed_tiers_' . $pid );

		$project = $pid ? HGD_Project::get( $pid ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		HGD_Quote::ensure_tiers( $pid );
		$good = HGD_Quote::for_project_tier( $pid, 'good' );
		if ( ! $good ) {
			$this->pricing_redirect( $pid, array( 'quote_error' => 1 ) );
		}

		$better_uplift = (float) HGD_Settings::get( 'better_uplift_pct', 25 );
		$best_uplift   = (float) HGD_Settings::get( 'best_uplift_pct', 60 );
		HGD_Quote::duplicate_to_tier( (int) $good['id'], 'better', $better_uplift );
		HGD_Quote::duplicate_to_tier( (int) $good['id'], 'best', $best_uplift );

		$this->pricing_redirect( $pid, array( 'tiers_seeded' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Proposals + milestone payments
	// -------------------------------------------------------------------------

	/** Redirect back to a project's Proposal tab with optional flash flags. */
	private function proposal_redirect( $pid, array $args = array() ) {
		$this->redirect_with( 'hgd-projects', array_merge(
			array( 'action' => 'edit', 'id' => (int) $pid, 'tab' => 'proposal' ),
			$args
		) );
	}

	/** Create a proposal from a chosen tier quote, then build its milestones. */
	public function handle_proposal_create() {
		$this->guard();
		$pid = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		check_admin_referer( 'hgd_proposal_create_' . $pid );

		$project = $pid ? HGD_Project::get( $pid ) : null;
		if ( ! $project ) {
			$this->redirect_with( 'hgd-projects', array() );
		}

		$quote_id = isset( $_POST['quote_id'] ) ? (int) $_POST['quote_id'] : 0;
		if ( ! $quote_id || ! HGD_Quote::quote_belongs_to_project( $quote_id, $pid ) ) {
			$this->proposal_redirect( $pid, array( 'proposal_error' => 1 ) );
		}

		$proposal_id = HGD_Proposal::create( $pid, $quote_id );
		if ( ! $proposal_id ) {
			$this->proposal_redirect( $pid, array( 'proposal_error' => 1 ) );
		}

		HGD_Proposal::generate_milestones( $proposal_id );
		$this->proposal_redirect( $pid, array( 'proposal_created' => 1 ) );
	}

	/** Save proposal copy + deposit fields, re-snapshot the total, regen milestones. */
	public function handle_proposal_save() {
		$this->guard();
		$pid         = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$proposal_id = isset( $_POST['proposal_id'] ) ? (int) $_POST['proposal_id'] : 0;
		check_admin_referer( 'hgd_proposal_save_' . $proposal_id );

		$proposal = $proposal_id ? HGD_Proposal::get( $proposal_id ) : null;
		if ( ! $proposal || (int) $proposal['project_id'] !== $pid ) {
			$this->proposal_redirect( $pid, array( 'proposal_error' => 1 ) );
		}

		$clean = HGD_Proposal::sanitise_settings( $_POST );

		// Re-snapshot the total from the linked quote (it may have changed).
		$totals = HGD_Quote::compute( (int) $proposal['quote_id'] );
		$clean['total_gbp'] = round( (float) $totals['total_rounded'], 2 );

		HGD_Proposal::update( $proposal_id, $clean );
		HGD_Proposal::generate_milestones( $proposal_id );

		$this->proposal_redirect( $pid, array( 'proposal_saved' => 1 ) );
	}

	/** Send the proposal to the client: status sent, email the portal link. */
	public function handle_proposal_send() {
		$this->guard();
		$pid         = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$proposal_id = isset( $_POST['proposal_id'] ) ? (int) $_POST['proposal_id'] : 0;
		check_admin_referer( 'hgd_proposal_send_' . $proposal_id );

		$proposal = $proposal_id ? HGD_Proposal::get( $proposal_id ) : null;
		if ( ! $proposal || (int) $proposal['project_id'] !== $pid ) {
			$this->proposal_redirect( $pid, array( 'proposal_error' => 1 ) );
		}

		$project = HGD_Project::get( $pid );
		$client  = ( $project && ! empty( $project['client_id'] ) ) ? HGD_Client::get( (int) $project['client_id'] ) : null;
		if ( ! $client || empty( $client['email'] ) || ! is_email( $client['email'] ) ) {
			$this->proposal_redirect( $pid, array( 'proposal_error' => 'noemail' ) );
		}

		$now = current_time( 'mysql' );
		HGD_Proposal::update( $proposal_id, array(
			'status'  => 'sent',
			'sent_at' => $now,
		) );
		HGD_Project::update( $pid, array( 'status' => 'proposed' ) );

		$proposal = HGD_Proposal::get( $proposal_id );
		$url      = HGD_Proposal::portal_url( $proposal );
		$site     = get_bloginfo( 'name' );
		$title    = $project ? (string) $project['title'] : __( 'your garden project', 'hillcroft-garden-designer' );

		$subject = sprintf( __( 'Your garden proposal — %s', 'hillcroft-garden-designer' ), $title );
		$body    = sprintf(
			__( "Hi %s,\n\nThank you for the opportunity to design %s. Your proposal is ready to review online — including the concept, costs and a simple payment plan.\n\nView and accept your proposal here:\n%s\n\nThis link is private to you. If you have any questions, just reply to this email.\n\nWarm regards,\n%s", 'hillcroft-garden-designer' ),
			HGD_Client::full_name( $client ),
			$title,
			$url,
			$site
		);
		wp_mail( $client['email'], $subject, $body, array( 'Content-Type: text/plain; charset=UTF-8' ) );

		$this->proposal_redirect( $pid, array( 'proposal_sent' => 1 ) );
	}

	/** Delete a proposal (and its payments). */
	public function handle_proposal_delete() {
		$this->guard();
		$pid         = isset( $_POST['project_id'] ) ? (int) $_POST['project_id'] : 0;
		$proposal_id = isset( $_POST['proposal_id'] ) ? (int) $_POST['proposal_id'] : 0;
		check_admin_referer( 'hgd_proposal_delete_' . $proposal_id );

		$proposal = $proposal_id ? HGD_Proposal::get( $proposal_id ) : null;
		if ( $proposal && (int) $proposal['project_id'] === $pid ) {
			HGD_Proposal::delete( $proposal_id );
		}

		$this->proposal_redirect( $pid, array( 'proposal_deleted' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Plants
	// -------------------------------------------------------------------------

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

	/** Stream the whole plant catalogue as a CSV download. */
	public function handle_plants_export() {
		$this->guard();
		check_admin_referer( 'hgd_plants_export' );

		$headers = HGD_Plant::csv_headers();
		$plants  = HGD_Plant::all();

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=hgd-plants-' . gmdate( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' );
		fputcsv( $out, $headers );
		foreach ( $plants as $plant ) {
			$row = array();
			foreach ( $headers as $key ) {
				$row[] = isset( $plant[ $key ] ) ? $plant[ $key ] : '';
			}
			fputcsv( $out, $row );
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}

	/** Import plants from an uploaded CSV — header row maps columns to plant fields. New rows only. */
	public function handle_plants_import() {
		$this->guard();
		check_admin_referer( 'hgd_plants_import' );

		if ( empty( $_FILES['csv'] ) || ! isset( $_FILES['csv']['tmp_name'] ) || '' === $_FILES['csv']['tmp_name'] || ! is_uploaded_file( $_FILES['csv']['tmp_name'] ) ) {
			$this->redirect_with( 'hgd-plants', array( 'import_error' => 'nofile' ) );
		}
		if ( ! empty( $_FILES['csv']['error'] ) ) {
			$this->redirect_with( 'hgd-plants', array( 'import_error' => 'upload' ) );
		}

		$handle = fopen( $_FILES['csv']['tmp_name'], 'r' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( false === $handle ) {
			$this->redirect_with( 'hgd-plants', array( 'import_error' => 'open' ) );
		}

		$fields = HGD_Plant::fields();
		$header = fgetcsv( $handle );
		if ( ! is_array( $header ) ) {
			fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			$this->redirect_with( 'hgd-plants', array( 'import_error' => 'empty' ) );
		}

		// Map each CSV column index to a known plant field key (ignore unknown columns).
		$map = array();
		foreach ( $header as $i => $name ) {
			$name = trim( (string) $name );
			if ( isset( $fields[ $name ] ) ) {
				$map[ $i ] = $name;
			}
		}

		$imported = 0;
		$skipped  = 0;
		$rows     = 0;
		$max_rows = 5000;

		while ( ( $row = fgetcsv( $handle ) ) !== false ) {
			if ( $rows >= $max_rows ) {
				break;
			}
			$rows++;

			// Skip wholly blank rows.
			if ( ! is_array( $row ) || '' === trim( implode( '', array_map( 'strval', $row ) ) ) ) {
				$skipped++;
				continue;
			}

			$raw = array();
			foreach ( $map as $i => $key ) {
				$raw[ $key ] = isset( $row[ $i ] ) ? $row[ $i ] : '';
			}

			$clean = HGD_Plant::sanitise( $raw );
			if ( '' === $clean['botanical_name'] && '' === $clean['common_name'] ) {
				$skipped++;
				continue;
			}

			HGD_Plant::insert( $clean );
			$imported++;
		}

		fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions

		$this->redirect_with( 'hgd-plants', array( 'imported' => $imported, 'skipped' => $skipped ) );
	}

	/** Fetch a freely-licensed plant photo from Wikipedia by botanical name and set it as the plant image. */
	public function handle_plant_fetch_photo() {
		$this->guard();
		$id = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		check_admin_referer( 'hgd_plant_fetch_photo_' . $id );

		$plant = $id ? HGD_Plant::get( $id ) : null;
		if ( ! $plant ) {
			$this->redirect_with( 'hgd-plants', array() );
		}

		$name = '' !== trim( (string) $plant['botanical_name'] ) ? (string) $plant['botanical_name'] : (string) $plant['common_name'];
		if ( '' === trim( $name ) ) {
			set_transient( 'hgd_plant_photo_error_' . get_current_user_id(), __( 'Add a botanical name first, then fetch a photo.', 'hillcroft-garden-designer' ), 120 );
			$this->redirect_with( 'hgd-plants', array( 'action' => 'edit', 'id' => $id, 'photo_error' => 1 ) );
		}

		$url = HGD_Wikimedia::fetch_image_for( $name );
		if ( is_wp_error( $url ) ) {
			set_transient( 'hgd_plant_photo_error_' . get_current_user_id(), $url->get_error_message(), 120 );
			$this->redirect_with( 'hgd-plants', array( 'action' => 'edit', 'id' => $id, 'photo_error' => 1 ) );
		}

		$att_id = HGD_Wikimedia::import_to_media( $url, $id, $name );
		if ( is_wp_error( $att_id ) ) {
			set_transient( 'hgd_plant_photo_error_' . get_current_user_id(), $att_id->get_error_message(), 120 );
			$this->redirect_with( 'hgd-plants', array( 'action' => 'edit', 'id' => $id, 'photo_error' => 1 ) );
		}

		HGD_Plant::update( $id, array( 'image_id' => (int) $att_id ) );
		$this->redirect_with( 'hgd-plants', array( 'action' => 'edit', 'id' => $id, 'photo_fetched' => 1 ) );
	}

	// -------------------------------------------------------------------------
	// Settings
	// -------------------------------------------------------------------------

	public function render_settings() {
		$this->guard();
		$banner_cb = array( $this, 'render_cost_banner' );
		$s         = HGD_Settings::all();
		$saved     = isset( $_GET['updated'] ); // phpcs:ignore WordPress.Security.NonceVerification
		include HGD_PATH . 'admin/views/settings.php';
	}

	/** Diagnose the GitHub update connection and report the result on Settings. */
	public function handle_test_update() {
		$this->guard();
		check_admin_referer( 'hgd_test_update' );

		$s = HGD_Settings::all();
		if ( empty( $s['github_token'] ) || empty( $s['github_repo'] ) ) {
			set_transient( 'hgd_update_test_' . get_current_user_id(), array( 'ok' => false, 'message' => __( 'Add the GitHub repository and access token first, then save.', 'hillcroft-garden-designer' ) ), 60 );
			$this->redirect_with( 'hgd-settings', array( 'update_test' => 1 ) );
		}

		$updater = new HGD_Updater(
			HGD_BASENAME,
			HGD_VERSION,
			$s['github_repo'],
			$s['github_token'],
			isset( $s['github_tag_prefix'] ) ? $s['github_tag_prefix'] : 'hgd-v'
		);
		$result = $updater->diagnose();

		set_transient( 'hgd_update_test_' . get_current_user_id(), $result, 60 );
		$this->redirect_with( 'hgd-settings', array( 'update_test' => 1 ) );
	}

	public function handle_save_settings() {
		$this->guard();
		check_admin_referer( 'hgd_save_settings' );

		$raw   = wp_unslash( $_POST );
		$input = array();

		foreach ( array(
			'claude_api_key', 'claude_model', 'gemini_api_key', 'gemini_image_model', 'flux_api_key', 'flux_model', 'render_style', 'google_maps_api_key', 'plantid_api_key',
			'stripe_secret_key', 'stripe_pub_key', 'stripe_webhook_secret',
			'github_repo', 'github_token',
			'github_tag_prefix', 'brand_olive', 'brand_charcoal', 'brand_cream',
			'google_client_id', 'google_client_secret', 'google_calendar_id',
			'avail_start', 'avail_end',
		) as $key ) {
			if ( isset( $raw[ $key ] ) ) {
				$input[ $key ] = sanitize_text_field( $raw[ $key ] );
			}
		}

		foreach ( array(
			'usd_to_gbp', 'eur_to_gbp', 'rate_claude_per_mtok_usd', 'rate_gemini_per_image_usd', 'rate_flux_per_image_usd',
			'rate_maps_per_1k_usd', 'rate_plantid_per_credit_eur', 'soft_monthly_cap_gbp',
			'consultation_fee_gbp', 'deposit_pct', 'commencement_pct', 'completion_pct',
			'proposal_expiry_days',
			'plantid_credits_balance',
			'slot_minutes', 'buffer_minutes', 'booking_lead_days', 'booking_window_days',
			'default_day_rate_gbp', 'default_wastage_pct', 'default_contingency_pct',
			'default_vat_pct', 'default_design_fee_gbp', 'better_uplift_pct', 'best_uplift_pct',
		) as $key ) {
			if ( isset( $raw[ $key ] ) ) {
				$input[ $key ] = (float) $raw[ $key ];
			}
		}

		$input['auto_update'] = empty( $raw['auto_update'] ) ? 0 : 1;

		// Default proposal terms — multiline, handled explicitly.
		if ( isset( $raw['terms_default'] ) ) {
			$input['terms_default'] = sanitize_textarea_field( $raw['terms_default'] );
		}

		// Availability days arrive as a checkbox array (1..7); normalise to a CSV string.
		if ( isset( $raw['avail_days'] ) && is_array( $raw['avail_days'] ) ) {
			$days = array_filter( array_map( 'intval', $raw['avail_days'] ), function ( $d ) {
				return $d >= 1 && $d <= 7;
			} );
			sort( $days );
			$input['avail_days'] = implode( ',', $days );
		}

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
		// Keep the wizard on the step the action was performed from: if this is a
		// project-edit redirect that doesn't already name a step, carry the step
		// submitted by the form (or present in the URL) through.
		if ( isset( $args['action'] ) && 'edit' === $args['action'] && ! isset( $args['step'] ) ) {
			$step = '';
			if ( isset( $_POST['step'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$step = sanitize_key( wp_unslash( $_POST['step'] ) );
			} elseif ( isset( $_GET['step'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$step = sanitize_key( wp_unslash( $_GET['step'] ) );
			}
			if ( '' !== $step ) {
				$args['step'] = $step;
			}
		}
		$args = array_merge( array( 'page' => $page ), array_filter( $args, function ( $v ) { return null !== $v; } ) );
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}

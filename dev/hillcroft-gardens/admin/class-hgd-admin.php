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
		add_action( 'admin_post_hgd_save_project', array( $this, 'handle_save_project' ) );
		add_action( 'admin_post_hgd_delete_project', array( $this, 'handle_delete_project' ) );
		add_action( 'admin_post_hgd_upload_assets', array( $this, 'handle_upload_assets' ) );
		add_action( 'admin_post_hgd_delete_asset', array( $this, 'handle_delete_asset' ) );
		add_action( 'admin_post_hgd_claude_read', array( $this, 'handle_claude_read' ) );
		add_action( 'admin_post_hgd_save_client', array( $this, 'handle_save_client' ) );
		add_action( 'admin_post_hgd_delete_client', array( $this, 'handle_delete_client' ) );
		add_action( 'admin_post_hgd_google_disconnect', array( $this, 'handle_google_disconnect' ) );
		add_action( 'admin_init', array( $this, 'maybe_handle_google_oauth' ) );
		add_action( 'admin_notices', array( $this, 'maybe_low_balance_notice' ) );
		add_filter( 'submenu_file', array( $this, 'highlight_forms_tab' ) );
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
		add_submenu_page( self::MENU, __( 'Projects', 'hillcroft-garden-designer' ), __( 'Projects', 'hillcroft-garden-designer' ), self::CAP, 'hgd-projects', array( $this, 'render_projects' ) );
		add_submenu_page( self::MENU, __( 'Clients', 'hillcroft-garden-designer' ), __( 'Clients', 'hillcroft-garden-designer' ), self::CAP, 'hgd-clients', array( $this, 'render_clients' ) );
		add_submenu_page( self::MENU, __( 'Forms', 'hillcroft-garden-designer' ), __( 'Forms', 'hillcroft-garden-designer' ), self::CAP, 'hgd-forms', array( $this, 'render_forms_hub' ) );
		add_submenu_page( self::MENU, __( 'Bookings', 'hillcroft-garden-designer' ), __( 'Bookings', 'hillcroft-garden-designer' ), self::CAP, 'hgd-bookings', array( $this, 'render_bookings' ) );
		add_submenu_page( self::MENU, __( 'Plant Catalogue', 'hillcroft-garden-designer' ), __( 'Plant Catalogue', 'hillcroft-garden-designer' ), self::CAP, 'hgd-plants', array( $this, 'render_plants' ) );
		add_submenu_page( self::MENU, __( 'Settings', 'hillcroft-garden-designer' ), __( 'Settings', 'hillcroft-garden-designer' ), self::CAP, 'hgd-settings', array( $this, 'render_settings' ) );
	}

	private function is_plugin_screen() {
		$screen = get_current_screen();
		return $screen && false !== strpos( $screen->id, 'hgd-' );
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
			$clients = HGD_Client::all();
			$assets  = ! empty( $project['id'] ) ? HGD_Project_Asset::for_project( (int) $project['id'] ) : array();
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

		$assets = HGD_Project_Asset::for_project( $id );
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
			. 'You are given one or more hand-drawn garden sketches (and possibly photos) from a site consultation. '
			. 'Carefully interpret the layout. READ any hand-written dimensions, measurements and annotations on the sketch. '
			. 'Identify zones and features: beds, borders, lawn, patio, decking, paths, walls, fences, steps, water features, '
			. 'existing trees/shrubs/plants, and anything else marked. '
			. 'Respond ONLY with a single JSON object with exactly two keys: '
			. '"reading" (a clear prose summary of everything you see, including all measurements you can read), and '
			. '"questions" (an array of specific clarifying questions to confirm you have read the sketch correctly). '
			. 'Do not wrap the JSON in markdown fences or add any text outside the JSON object.';

		$result = HGD_Claude::message( $blocks, $system, 2000, $id );

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

	/** Tolerant JSON extraction: grab the first {...} block and decode it. */
	private function parse_claude_json( $text ) {
		$text = trim( (string) $text );
		if ( '' === $text ) {
			return null;
		}
		$decoded = json_decode( $text, true );
		if ( is_array( $decoded ) ) {
			return $decoded;
		}
		$start = strpos( $text, '{' );
		$end   = strrpos( $text, '}' );
		if ( false !== $start && false !== $end && $end > $start ) {
			$candidate = substr( $text, $start, $end - $start + 1 );
			$decoded   = json_decode( $candidate, true );
			if ( is_array( $decoded ) ) {
				return $decoded;
			}
		}
		return null;
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

	public function handle_save_settings() {
		$this->guard();
		check_admin_referer( 'hgd_save_settings' );

		$raw   = wp_unslash( $_POST );
		$input = array();

		foreach ( array(
			'claude_api_key', 'claude_model', 'gemini_api_key', 'google_maps_api_key', 'plantid_api_key',
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
			'usd_to_gbp', 'eur_to_gbp', 'rate_claude_per_mtok_usd', 'rate_gemini_per_image_usd',
			'rate_maps_per_1k_usd', 'rate_plantid_per_credit_eur', 'soft_monthly_cap_gbp',
			'consultation_fee_gbp', 'deposit_pct', 'commencement_pct', 'completion_pct',
			'plantid_credits_balance',
			'slot_minutes', 'buffer_minutes', 'booking_lead_days', 'booking_window_days',
		) as $key ) {
			if ( isset( $raw[ $key ] ) ) {
				$input[ $key ] = (float) $raw[ $key ];
			}
		}

		$input['auto_update'] = empty( $raw['auto_update'] ) ? 0 : 1;

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
		$args = array_merge( array( 'page' => $page ), array_filter( $args, function ( $v ) { return null !== $v; } ) );
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}

<?php
/**
 * Plugin Name:       Trinity Court Projects
 * Plugin URI:        https://trinitycourtmargate.co.uk/
 * Description:        Logs building improvement works for Trinity Court, tracks status, priority, quoted cost and a running total, groups works into programmes (epics / initiatives / sprints), attaches quote documents, exports to XLS and PDF, and lets residents vote and comment. Display anywhere with the [trinity_projects] shortcode.
 * Version:           1.1.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            October Communications
 * Author URI:        https://octobercomms.com/
 * License:           GPL-2.0-or-later
 * Text Domain:       trinity-court-projects
 *
 * @package Trinity_Court_Projects
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TCP_VERSION', '1.1.1' );
define( 'TCP_FILE', __FILE__ );
define( 'TCP_DIR', plugin_dir_path( __FILE__ ) );
define( 'TCP_URL', plugin_dir_url( __FILE__ ) );

require_once TCP_DIR . 'includes/seed-data.php';

/**
 * Main plugin class.
 */
final class Trinity_Court_Projects {

	const CPT      = 'tcp_project';
	const TAX_CAT  = 'tcp_category';
	const TAX_GRP  = 'tcp_group';

	/** @var Trinity_Court_Projects */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		// Registration.
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'init', array( $this, 'register_taxonomies' ) );

		// Admin UI.
		add_action( 'add_meta_boxes', array( $this, 'add_meta_boxes' ) );
		add_action( 'save_post_' . self::CPT, array( $this, 'save_meta' ), 10, 2 );
		add_filter( 'manage_' . self::CPT . '_posts_columns', array( $this, 'admin_columns' ) );
		add_action( 'manage_' . self::CPT . '_posts_custom_column', array( $this, 'admin_column_content' ), 10, 2 );
		add_filter( 'manage_edit-' . self::CPT . '_sortable_columns', array( $this, 'admin_sortable_columns' ) );
		add_action( 'pre_get_posts', array( $this, 'admin_orderby' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'admin_assets' ) );
		add_action( 'admin_menu', array( $this, 'admin_import_page' ) );
		add_action( 'admin_notices', array( $this, 'maybe_seed_notice' ) );

		// Group (programme) term meta: type field.
		add_action( self::TAX_GRP . '_add_form_fields', array( $this, 'group_add_field' ) );
		add_action( self::TAX_GRP . '_edit_form_fields', array( $this, 'group_edit_field' ) );
		add_action( 'created_' . self::TAX_GRP, array( $this, 'save_group_meta' ) );
		add_action( 'edited_' . self::TAX_GRP, array( $this, 'save_group_meta' ) );

		// Front end.
		add_shortcode( 'trinity_projects', array( $this, 'render_shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'front_assets' ) );

		// Downloads (XLS / print-to-PDF).
		add_action( 'template_redirect', array( $this, 'maybe_export' ) );

		// AJAX: voting + comments.
		add_action( 'wp_ajax_tcp_vote', array( $this, 'ajax_vote' ) );
		add_action( 'wp_ajax_nopriv_tcp_vote', array( $this, 'ajax_vote' ) );
		add_action( 'wp_ajax_tcp_comment', array( $this, 'ajax_comment' ) );
		add_action( 'wp_ajax_nopriv_tcp_comment', array( $this, 'ajax_comment' ) );

		// Keep the CPT's comments out of the global (site-wide) comment stream/feeds.
		add_filter( 'comments_clauses', array( $this, 'hide_project_comments_globally' ), 10, 2 );

		// Activation.
		register_activation_hook( TCP_FILE, array( __CLASS__, 'activate' ) );
		register_deactivation_hook( TCP_FILE, 'flush_rewrite_rules' );
	}

	/* ---------------------------------------------------------------------
	 * Controlled vocabularies
	 * ------------------------------------------------------------------- */

	/**
	 * Status pipeline. slug => [label, colour].
	 */
	public static function statuses() {
		return array(
			'not-started'     => array( 'Not started', '#8a8f98' ),
			'arranging-quote' => array( 'Arranging quote', '#c77d29' ),
			'quoted'          => array( 'Quoted', '#2b6cb0' ),
			'queued'          => array( 'Queued', '#6b46c1' ),
			'started'         => array( 'Started', '#1f9d8f' ),
			'completed'       => array( 'Completed', '#2f855a' ),
			'on-hold'         => array( 'On hold', '#b23b3b' ),
		);
	}

	/**
	 * Priority levels. slug => [label, colour, weight for sorting].
	 */
	public static function priorities() {
		return array(
			'urgent'   => array( 'Urgent', '#b23b3b', 5 ),
			'high'     => array( 'High', '#c77d29', 4 ),
			'medium'   => array( 'Medium', '#2b6cb0', 3 ),
			'low'      => array( 'Low', '#5a8f4b', 2 ),
			'wishlist' => array( 'Wishlist', '#8a8f98', 1 ),
			'tbc'      => array( 'TBC', '#8a8f98', 0 ),
		);
	}

	/**
	 * Cost basis for a figure. slug => label.
	 */
	public static function cost_types() {
		return array(
			''         => 'Not set',
			'estimate' => 'Rough estimate',
			'quote'    => 'Formal quote',
			'final'    => 'Final / invoiced',
		);
	}

	/**
	 * Programme (group) types, using the recognised project hierarchy.
	 * slug => label.
	 */
	public static function group_types() {
		return array(
			'epic'       => 'Epic',
			'initiative' => 'Initiative',
			'sprint'     => 'Sprint',
			'milestone'  => 'Milestone',
		);
	}

	public static function status_label( $slug ) {
		$s = self::statuses();
		return isset( $s[ $slug ] ) ? $s[ $slug ][0] : 'Not started';
	}

	public static function status_colour( $slug ) {
		$s = self::statuses();
		return isset( $s[ $slug ] ) ? $s[ $slug ][1] : '#8a8f98';
	}

	public static function priority_label( $slug ) {
		$p = self::priorities();
		return isset( $p[ $slug ] ) ? $p[ $slug ][0] : 'TBC';
	}

	public static function priority_colour( $slug ) {
		$p = self::priorities();
		return isset( $p[ $slug ] ) ? $p[ $slug ][1] : '#8a8f98';
	}

	/* ---------------------------------------------------------------------
	 * Registration
	 * ------------------------------------------------------------------- */

	public function register_post_type() {
		$labels = array(
			'name'               => 'Projects',
			'singular_name'      => 'Project',
			'add_new'            => 'Add new',
			'add_new_item'       => 'Add new project',
			'edit_item'          => 'Edit project',
			'new_item'           => 'New project',
			'view_item'          => 'View project',
			'search_items'       => 'Search projects',
			'not_found'          => 'No projects found',
			'not_found_in_trash' => 'No projects in trash',
			'menu_name'          => 'Projects',
			'all_items'          => 'All projects',
		);

		register_post_type(
			self::CPT,
			array(
				'labels'       => $labels,
				'public'       => true,
				'has_archive'  => false,
				'show_in_rest' => true,
				'menu_icon'    => 'dashicons-clipboard',
				'menu_position'=> 25,
				'supports'     => array( 'title', 'editor', 'comments', 'revisions' ),
				'rewrite'      => array( 'slug' => 'building-works' ),
			)
		);
	}

	public function register_taxonomies() {
		register_taxonomy(
			self::TAX_CAT,
			self::CPT,
			array(
				'labels'            => array(
					'name'          => 'Categories',
					'singular_name' => 'Category',
					'menu_name'     => 'Categories',
				),
				'hierarchical'      => true,
				'public'            => true,
				'show_admin_column' => true,
				'show_in_rest'      => true,
				'rewrite'           => array( 'slug' => 'works-category' ),
			)
		);

		register_taxonomy(
			self::TAX_GRP,
			self::CPT,
			array(
				'labels'            => array(
					'name'          => 'Programmes',
					'singular_name' => 'Programme',
					'menu_name'     => 'Programmes',
					'add_new_item'  => 'Add new programme',
					'search_items'  => 'Search programmes',
					'all_items'     => 'All programmes',
				),
				'hierarchical'      => true,
				'public'            => true,
				'show_admin_column' => true,
				'show_in_rest'      => true,
				'rewrite'           => array( 'slug' => 'works-programme' ),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Admin: meta boxes
	 * ------------------------------------------------------------------- */

	public function add_meta_boxes() {
		add_meta_box(
			'tcp_details',
			'Project tracking',
			array( $this, 'render_meta_box' ),
			self::CPT,
			'side',
			'high'
		);
		add_meta_box(
			'tcp_solution',
			'Proposed solution',
			array( $this, 'render_solution_box' ),
			self::CPT,
			'normal',
			'high'
		);
		add_meta_box(
			'tcp_docs',
			'Quote documents',
			array( $this, 'render_docs_box' ),
			self::CPT,
			'side',
			'default'
		);
	}

	public function render_docs_box( $post ) {
		$docs = get_post_meta( $post->ID, '_tcp_quote_docs', true );
		if ( ! is_array( $docs ) ) {
			$docs = array();
		}
		?>
		<p class="description">Attach the actual quote(s) (PDF, image or document). Residents can open them from the project.</p>
		<ul class="tcp-doc-list">
			<?php foreach ( $docs as $att_id ) :
				$att_id = (int) $att_id;
				$url    = wp_get_attachment_url( $att_id );
				if ( ! $url ) {
					continue;
				}
				?>
				<li data-id="<?php echo esc_attr( $att_id ); ?>">
					<span class="dashicons dashicons-media-document"></span>
					<a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener"><?php echo esc_html( get_the_title( $att_id ) ? get_the_title( $att_id ) : basename( $url ) ); ?></a>
					<button type="button" class="button-link tcp-doc-remove" aria-label="Remove">&times;</button>
				</li>
			<?php endforeach; ?>
		</ul>
		<input type="hidden" id="tcp_quote_docs" name="tcp_quote_docs" value="<?php echo esc_attr( implode( ',', array_map( 'intval', $docs ) ) ); ?>" />
		<button type="button" class="button" id="tcp_add_doc">Add quote document</button>
		<?php
	}

	public function render_meta_box( $post ) {
		wp_nonce_field( 'tcp_save_meta', 'tcp_meta_nonce' );

		$ref       = get_post_meta( $post->ID, '_tcp_ref', true );
		$status    = get_post_meta( $post->ID, '_tcp_status', true );
		$priority  = get_post_meta( $post->ID, '_tcp_priority', true );
		$cost      = get_post_meta( $post->ID, '_tcp_cost', true );
		$cost_type = get_post_meta( $post->ID, '_tcp_cost_type', true );
		$location  = get_post_meta( $post->ID, '_tcp_location', true );
		$votes     = (int) get_post_meta( $post->ID, '_tcp_votes', true );

		if ( '' === $status ) {
			$status = 'not-started';
		}
		if ( '' === $priority ) {
			$priority = 'tbc';
		}
		?>
		<p>
			<label for="tcp_ref"><strong>Reference no.</strong></label><br />
			<input type="text" id="tcp_ref" name="tcp_ref" value="<?php echo esc_attr( $ref ); ?>" style="width:100%" />
		</p>
		<p>
			<label for="tcp_status"><strong>Status</strong></label><br />
			<select id="tcp_status" name="tcp_status" style="width:100%">
				<?php foreach ( self::statuses() as $slug => $data ) : ?>
					<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $status, $slug ); ?>><?php echo esc_html( $data[0] ); ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<p>
			<label for="tcp_priority"><strong>Priority</strong></label><br />
			<select id="tcp_priority" name="tcp_priority" style="width:100%">
				<?php foreach ( self::priorities() as $slug => $data ) : ?>
					<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $priority, $slug ); ?>><?php echo esc_html( $data[0] ); ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<hr />
		<p>
			<label for="tcp_cost"><strong>Cost (£)</strong></label><br />
			<input type="number" step="0.01" min="0" id="tcp_cost" name="tcp_cost" value="<?php echo esc_attr( $cost ); ?>" style="width:100%" placeholder="Leave blank until quoted" />
		</p>
		<p>
			<label for="tcp_cost_type"><strong>Cost basis</strong></label><br />
			<select id="tcp_cost_type" name="tcp_cost_type" style="width:100%">
				<?php foreach ( self::cost_types() as $slug => $label ) : ?>
					<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $cost_type, $slug ); ?>><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<hr />
		<p>
			<label for="tcp_location"><strong>Location / scope</strong></label><br />
			<input type="text" id="tcp_location" name="tcp_location" value="<?php echo esc_attr( $location ); ?>" style="width:100%" />
		</p>
		<p style="color:#666;margin-top:12px;">
			<span class="dashicons dashicons-thumbs-up" style="vertical-align:middle"></span>
			<strong><?php echo esc_html( $votes ); ?></strong> resident vote<?php echo 1 === $votes ? '' : 's'; ?>
		</p>
		<?php
	}

	public function render_solution_box( $post ) {
		$solution = get_post_meta( $post->ID, '_tcp_solution', true );
		?>
		<p class="description">The proposed fix, in enough detail to scope it. Shown to residents inside the project detail. The main editor above holds the <strong>problem</strong> description.</p>
		<textarea name="tcp_solution" rows="6" style="width:100%"><?php echo esc_textarea( $solution ); ?></textarea>
		<?php
	}

	public function save_meta( $post_id, $post ) {
		if ( ! isset( $_POST['tcp_meta_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['tcp_meta_nonce'] ) ), 'tcp_save_meta' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$fields = array(
			'_tcp_ref'      => isset( $_POST['tcp_ref'] ) ? sanitize_text_field( wp_unslash( $_POST['tcp_ref'] ) ) : '',
			'_tcp_location' => isset( $_POST['tcp_location'] ) ? sanitize_text_field( wp_unslash( $_POST['tcp_location'] ) ) : '',
			'_tcp_solution' => isset( $_POST['tcp_solution'] ) ? sanitize_textarea_field( wp_unslash( $_POST['tcp_solution'] ) ) : '',
		);

		$status = isset( $_POST['tcp_status'] ) ? sanitize_key( wp_unslash( $_POST['tcp_status'] ) ) : 'not-started';
		if ( ! array_key_exists( $status, self::statuses() ) ) {
			$status = 'not-started';
		}
		$fields['_tcp_status'] = $status;

		$priority = isset( $_POST['tcp_priority'] ) ? sanitize_key( wp_unslash( $_POST['tcp_priority'] ) ) : 'tbc';
		if ( ! array_key_exists( $priority, self::priorities() ) ) {
			$priority = 'tbc';
		}
		$fields['_tcp_priority'] = $priority;

		$cost_type = isset( $_POST['tcp_cost_type'] ) ? sanitize_key( wp_unslash( $_POST['tcp_cost_type'] ) ) : '';
		if ( ! array_key_exists( $cost_type, self::cost_types() ) ) {
			$cost_type = '';
		}
		$fields['_tcp_cost_type'] = $cost_type;

		// Cost: store as float, or delete when blank.
		if ( isset( $_POST['tcp_cost'] ) && '' !== trim( wp_unslash( $_POST['tcp_cost'] ) ) ) {
			$fields['_tcp_cost'] = round( (float) wp_unslash( $_POST['tcp_cost'] ), 2 );
		} else {
			delete_post_meta( $post_id, '_tcp_cost' );
		}

		// Quote documents: comma-separated attachment IDs.
		if ( isset( $_POST['tcp_quote_docs'] ) ) {
			$ids = array_filter( array_map( 'absint', explode( ',', sanitize_text_field( wp_unslash( $_POST['tcp_quote_docs'] ) ) ) ) );
			if ( $ids ) {
				update_post_meta( $post_id, '_tcp_quote_docs', array_values( $ids ) );
			} else {
				delete_post_meta( $post_id, '_tcp_quote_docs' );
			}
		}

		foreach ( $fields as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}
	}

	/* ---------------------------------------------------------------------
	 * Admin: list table columns
	 * ------------------------------------------------------------------- */

	public function admin_columns( $columns ) {
		$new = array();
		foreach ( $columns as $key => $label ) {
			if ( 'title' === $key ) {
				$new['tcp_ref'] = 'Ref';
			}
			$new[ $key ] = $label;
			if ( 'title' === $key ) {
				$new['tcp_status']   = 'Status';
				$new['tcp_priority'] = 'Priority';
				$new['tcp_cost']     = 'Cost';
				$new['tcp_votes']    = 'Votes';
			}
		}
		return $new;
	}

	public function admin_column_content( $column, $post_id ) {
		switch ( $column ) {
			case 'tcp_ref':
				echo esc_html( get_post_meta( $post_id, '_tcp_ref', true ) );
				break;
			case 'tcp_status':
				$status = get_post_meta( $post_id, '_tcp_status', true );
				printf(
					'<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;color:#fff;background:%s">%s</span>',
					esc_attr( self::status_colour( $status ) ),
					esc_html( self::status_label( $status ) )
				);
				break;
			case 'tcp_priority':
				$priority = get_post_meta( $post_id, '_tcp_priority', true );
				printf(
					'<span style="color:%s;font-weight:600">%s</span>',
					esc_attr( self::priority_colour( $priority ) ),
					esc_html( self::priority_label( $priority ) )
				);
				break;
			case 'tcp_cost':
				$cost = get_post_meta( $post_id, '_tcp_cost', true );
				echo '' === $cost ? '<span style="color:#999">—</span>' : esc_html( self::money( (float) $cost ) );
				break;
			case 'tcp_votes':
				echo esc_html( (int) get_post_meta( $post_id, '_tcp_votes', true ) );
				break;
		}
	}

	public function admin_sortable_columns( $columns ) {
		$columns['tcp_status']   = 'tcp_status';
		$columns['tcp_priority'] = 'tcp_priority';
		$columns['tcp_cost']     = 'tcp_cost';
		$columns['tcp_votes']    = 'tcp_votes';
		return $columns;
	}

	public function admin_orderby( $query ) {
		if ( ! is_admin() || ! $query->is_main_query() ) {
			return;
		}
		$orderby = $query->get( 'orderby' );
		$map     = array(
			'tcp_status'   => array( '_tcp_status', 'meta_value' ),
			'tcp_priority' => array( '_tcp_priority', 'meta_value' ),
			'tcp_cost'     => array( '_tcp_cost', 'meta_value_num' ),
			'tcp_votes'    => array( '_tcp_votes', 'meta_value_num' ),
		);
		if ( isset( $map[ $orderby ] ) ) {
			$query->set( 'meta_key', $map[ $orderby ][0] );
			$query->set( 'orderby', $map[ $orderby ][1] );
		}
	}

	public function admin_assets( $hook ) {
		$screen = get_current_screen();
		if ( $screen && self::CPT === $screen->post_type ) {
			wp_enqueue_style( 'tcp-admin', TCP_URL . 'assets/admin.css', array(), TCP_VERSION );
			if ( in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
				wp_enqueue_media();
				wp_enqueue_script( 'tcp-admin', TCP_URL . 'assets/admin.js', array( 'jquery' ), TCP_VERSION, true );
			}
		}
	}

	/* ---------------------------------------------------------------------
	 * Admin: programme (group) type field
	 * ------------------------------------------------------------------- */

	public function group_add_field() {
		?>
		<div class="form-field">
			<label for="tcp_group_type">Type</label>
			<select name="tcp_group_type" id="tcp_group_type">
				<?php foreach ( self::group_types() as $slug => $label ) : ?>
					<option value="<?php echo esc_attr( $slug ); ?>"><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
			<p>Epic (a bundle of related works delivered together), Initiative (a large scheme spanning several epics), Sprint (a time-boxed batch committed to next), or Milestone (a dated target the works roll up to).</p>
		</div>
		<?php
	}

	public function group_edit_field( $term ) {
		$type = get_term_meta( $term->term_id, 'tcp_group_type', true );
		if ( '' === $type ) {
			$type = 'epic';
		}
		?>
		<tr class="form-field">
			<th scope="row"><label for="tcp_group_type">Type</label></th>
			<td>
				<select name="tcp_group_type" id="tcp_group_type">
					<?php foreach ( self::group_types() as $slug => $label ) : ?>
						<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $type, $slug ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</td>
		</tr>
		<?php
	}

	public function save_group_meta( $term_id ) {
		if ( ! current_user_can( 'manage_categories' ) ) {
			return;
		}
		if ( isset( $_POST['tcp_group_type'] ) ) {
			$type = sanitize_key( wp_unslash( $_POST['tcp_group_type'] ) );
			if ( array_key_exists( $type, self::group_types() ) ) {
				update_term_meta( $term_id, 'tcp_group_type', $type );
			}
		}
	}

	/* ---------------------------------------------------------------------
	 * Front end
	 * ------------------------------------------------------------------- */

	public function front_assets() {
		wp_register_style( 'tcp-frontend', TCP_URL . 'assets/frontend.css', array(), TCP_VERSION );
		wp_register_script( 'tcp-frontend', TCP_URL . 'assets/frontend.js', array(), TCP_VERSION, true );
		wp_localize_script(
			'tcp-frontend',
			'TCP',
			array(
				'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
				'nonce'        => wp_create_nonce( 'tcp_public' ),
				'isLoggedIn'   => is_user_logged_in(),
				'currentUser'  => is_user_logged_in() ? wp_get_current_user()->display_name : '',
			)
		);
	}

	/**
	 * [trinity_projects] shortcode.
	 *
	 * Attributes:
	 *   view      "programme" (default) or "flat"
	 *   summary   "yes" (default) or "no"
	 *   voting    "yes" (default) or "no"
	 *   comments  "yes" (default) or "no"
	 *   accent    a CSS colour to theme the tracker (defaults to the building
	 *             burgundy). e.g. accent="#123456" to match the site brand.
	 */
	public function render_shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'view'     => 'programme',
				'summary'  => 'yes',
				'voting'   => 'yes',
				'comments' => 'yes',
				'accent'   => '',
			),
			$atts,
			'trinity_projects'
		);

		wp_enqueue_style( 'tcp-frontend' );
		wp_enqueue_script( 'tcp-frontend' );

		// Optional per-page accent override.
		$style = '';
		if ( '' !== $atts['accent'] && preg_match( '/^#?[0-9a-zA-Z(),.%\s]{3,40}$/', $atts['accent'] ) ) {
			$style = ' style="--tcp-accent:' . esc_attr( $atts['accent'] ) . '"';
		}

		$projects = get_posts(
			array(
				'post_type'      => self::CPT,
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'orderby'        => 'menu_order title',
				'order'          => 'ASC',
			)
		);

		$voting_on   = 'no' !== $atts['voting'];
		$comments_on = 'no' !== $atts['comments'];

		ob_start();
		echo '<div class="tcp-app" data-view="' . esc_attr( $atts['view'] ) . '"' . $style . '>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $style pre-escaped above.

		if ( 'no' !== $atts['summary'] ) {
			echo $this->render_summary( $projects ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built with escaping inside.
		}

		echo $this->render_toolbar( $projects );

		if ( empty( $projects ) ) {
			echo '<p class="tcp-empty">No works have been logged yet.</p>';
		} elseif ( 'flat' === $atts['view'] ) {
			echo '<div class="tcp-list">';
			foreach ( $projects as $project ) {
				echo $this->render_card( $project, $voting_on, $comments_on ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			}
			echo '</div>';
		} else {
			echo $this->render_grouped( $projects, $voting_on, $comments_on ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}

		echo '<p class="tcp-disclaimer">This tracker is for resident visibility and informal input only. It is not the official reporting channel. Anything that must formally reach the managing agent (repairs, complaints, service-charge queries) still goes directly to them by their official route.</p>';
		echo '</div>';
		return ob_get_clean();
	}

	/**
	 * Summary bar with running totals.
	 */
	private function render_summary( $projects ) {
		$total       = 0.0;
		$spent       = 0.0;
		$pipeline    = 0.0;
		$count       = count( $projects );
		$done        = 0;
		$costed      = 0;

		foreach ( $projects as $p ) {
			$status = get_post_meta( $p->ID, '_tcp_status', true );
			$cost   = get_post_meta( $p->ID, '_tcp_cost', true );
			if ( 'completed' === $status ) {
				$done++;
			}
			if ( '' !== $cost ) {
				$costed++;
				$total += (float) $cost;
				if ( 'completed' === $status ) {
					$spent += (float) $cost;
				} else {
					$pipeline += (float) $cost;
				}
			}
		}

		$awaiting = $count - $costed;

		ob_start();
		?>
		<div class="tcp-summary">
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( $count ); ?></span>
				<span class="tcp-stat-label">works logged</span>
			</div>
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( $done ); ?> / <?php echo esc_html( $count ); ?></span>
				<span class="tcp-stat-label">completed</span>
			</div>
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( self::money( $total ) ); ?></span>
				<span class="tcp-stat-label">total costed</span>
			</div>
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( self::money( $spent ) ); ?></span>
				<span class="tcp-stat-label">spent (completed)</span>
			</div>
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( self::money( $pipeline ) ); ?></span>
				<span class="tcp-stat-label">committed / in pipeline</span>
			</div>
			<div class="tcp-stat">
				<span class="tcp-stat-num"><?php echo esc_html( $awaiting ); ?></span>
				<span class="tcp-stat-label">awaiting a quote</span>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Filter + sort toolbar.
	 */
	private function render_toolbar( $projects ) {
		$statuses = self::statuses();
		ob_start();
		?>
		<div class="tcp-toolbar">
			<div class="tcp-filters" role="group" aria-label="Filter by status">
				<button type="button" class="tcp-filter is-active" data-filter="all">All</button>
				<?php foreach ( $statuses as $slug => $data ) : ?>
					<button type="button" class="tcp-filter" data-filter="<?php echo esc_attr( $slug ); ?>"><?php echo esc_html( $data[0] ); ?></button>
				<?php endforeach; ?>
			</div>
			<div class="tcp-tools-right">
				<label class="tcp-sort">
					Sort:
					<select class="tcp-sort-select">
						<option value="ref">Reference</option>
						<option value="priority">Priority</option>
						<option value="votes">Most voted</option>
						<option value="cost">Cost (high to low)</option>
						<option value="status">Status</option>
					</select>
				</label>
				<span class="tcp-downloads">
					<a class="tcp-download" href="<?php echo esc_url( add_query_arg( 'tcp_export', 'xls', home_url( '/' ) ) ); ?>">Download XLS</a>
					<a class="tcp-download" href="<?php echo esc_url( add_query_arg( 'tcp_export', 'pdf', home_url( '/' ) ) ); ?>" target="_blank" rel="noopener">Download PDF</a>
				</span>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Grouped-by-programme view. Ungrouped items fall into an "Individual works" bucket.
	 */
	private function render_grouped( $projects, $voting_on, $comments_on ) {
		$groups     = get_terms(
			array(
				'taxonomy'   => self::TAX_GRP,
				'hide_empty' => true,
			)
		);
		$rendered   = array();
		$ungrouped  = array();

		ob_start();

		if ( ! is_wp_error( $groups ) && ! empty( $groups ) ) {
			foreach ( $groups as $group ) {
				$members = array();
				foreach ( $projects as $p ) {
					if ( has_term( $group->term_id, self::TAX_GRP, $p ) ) {
						$members[]              = $p;
						$rendered[ $p->ID ]     = true;
					}
				}
				if ( empty( $members ) ) {
					continue;
				}
				echo $this->render_group_block( $group, $members, $voting_on, $comments_on ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			}
		}

		foreach ( $projects as $p ) {
			if ( empty( $rendered[ $p->ID ] ) ) {
				$ungrouped[] = $p;
			}
		}

		if ( ! empty( $ungrouped ) ) {
			echo '<div class="tcp-group tcp-group--loose">';
			echo '<div class="tcp-group-head"><h3 class="tcp-group-title">Individual works</h3>';
			echo '<span class="tcp-group-meta">' . esc_html( count( $ungrouped ) ) . ' items · ' . esc_html( self::money( $this->sum_cost( $ungrouped ) ) ) . ' costed</span></div>';
			echo '<div class="tcp-list">';
			foreach ( $ungrouped as $p ) {
				echo $this->render_card( $p, $voting_on, $comments_on ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			}
			echo '</div></div>';
		}

		return ob_get_clean();
	}

	private function render_group_block( $group, $members, $voting_on, $comments_on ) {
		$type       = get_term_meta( $group->term_id, 'tcp_group_type', true );
		$type_label = isset( self::group_types()[ $type ] ) ? self::group_types()[ $type ] : 'Epic';
		$total      = $this->sum_cost( $members );
		$done       = 0;
		foreach ( $members as $m ) {
			if ( 'completed' === get_post_meta( $m->ID, '_tcp_status', true ) ) {
				$done++;
			}
		}
		$count   = count( $members );
		$percent = $count ? round( ( $done / $count ) * 100 ) : 0;

		ob_start();
		?>
		<div class="tcp-group tcp-group--<?php echo esc_attr( $type ); ?>">
			<div class="tcp-group-head">
				<div>
					<span class="tcp-group-type"><?php echo esc_html( $type_label ); ?></span>
					<h3 class="tcp-group-title"><?php echo esc_html( $group->name ); ?></h3>
					<?php if ( $group->description ) : ?>
						<p class="tcp-group-desc"><?php echo esc_html( $group->description ); ?></p>
					<?php endif; ?>
				</div>
				<div class="tcp-group-stats">
					<span class="tcp-group-meta"><?php echo esc_html( $done ); ?>/<?php echo esc_html( $count ); ?> done</span>
					<span class="tcp-group-cost"><?php echo esc_html( self::money( $total ) ); ?></span>
				</div>
			</div>
			<div class="tcp-progress"><span style="width:<?php echo esc_attr( $percent ); ?>%"></span></div>
			<div class="tcp-list">
				<?php foreach ( $members as $m ) {
					echo $this->render_card( $m, $voting_on, $comments_on ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				} ?>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * A single project card.
	 */
	private function render_card( $project, $voting_on, $comments_on ) {
		$id        = $project->ID;
		$ref       = get_post_meta( $id, '_tcp_ref', true );
		$status    = get_post_meta( $id, '_tcp_status', true );
		$priority  = get_post_meta( $id, '_tcp_priority', true );
		$cost      = get_post_meta( $id, '_tcp_cost', true );
		$cost_type = get_post_meta( $id, '_tcp_cost_type', true );
		$location  = get_post_meta( $id, '_tcp_location', true );
		$solution  = get_post_meta( $id, '_tcp_solution', true );
		$votes     = (int) get_post_meta( $id, '_tcp_votes', true );
		$priority_w = isset( self::priorities()[ $priority ] ) ? self::priorities()[ $priority ][2] : 0;

		$cats  = wp_get_post_terms( $id, self::TAX_CAT, array( 'fields' => 'names' ) );
		$cat   = ! is_wp_error( $cats ) && ! empty( $cats ) ? $cats[0] : '';

		$has_voted = $this->has_voted( $id ) ? '1' : '0';

		$comment_count = $comments_on ? (int) get_comments_number( $id ) : 0;

		ob_start();
		?>
		<article class="tcp-card"
			data-status="<?php echo esc_attr( $status ); ?>"
			data-priority="<?php echo esc_attr( $priority_w ); ?>"
			data-votes="<?php echo esc_attr( $votes ); ?>"
			data-cost="<?php echo esc_attr( '' === $cost ? 0 : $cost ); ?>"
			data-ref="<?php echo esc_attr( (int) $ref ); ?>"
			data-id="<?php echo esc_attr( $id ); ?>">

			<header class="tcp-card-head">
				<button type="button" class="tcp-card-toggle" aria-expanded="false">
					<span class="tcp-ref">#<?php echo esc_html( $ref ); ?></span>
					<span class="tcp-title"><?php echo esc_html( get_the_title( $project ) ); ?></span>
					<span class="tcp-chevron" aria-hidden="true"></span>
				</button>
				<div class="tcp-badges">
					<?php if ( $cat ) : ?>
						<span class="tcp-cat"><?php echo esc_html( $cat ); ?></span>
					<?php endif; ?>
					<span class="tcp-badge tcp-priority" style="--c:<?php echo esc_attr( self::priority_colour( $priority ) ); ?>"><?php echo esc_html( self::priority_label( $priority ) ); ?></span>
					<span class="tcp-badge tcp-status" style="--c:<?php echo esc_attr( self::status_colour( $status ) ); ?>"><?php echo esc_html( self::status_label( $status ) ); ?></span>
				</div>
			</header>

			<div class="tcp-card-meta">
				<span class="tcp-cost-tag">
					<?php if ( '' === $cost ) : ?>
						<em>Awaiting quote</em>
					<?php else : ?>
						<strong><?php echo esc_html( self::money( (float) $cost ) ); ?></strong>
						<?php if ( $cost_type && isset( self::cost_types()[ $cost_type ] ) ) : ?>
							<span class="tcp-cost-basis"><?php echo esc_html( self::cost_types()[ $cost_type ] ); ?></span>
						<?php endif; ?>
					<?php endif; ?>
				</span>

				<?php if ( $voting_on ) : ?>
					<button type="button" class="tcp-vote<?php echo '1' === $has_voted ? ' is-voted' : ''; ?>" data-id="<?php echo esc_attr( $id ); ?>" data-voted="<?php echo esc_attr( $has_voted ); ?>" aria-pressed="<?php echo '1' === $has_voted ? 'true' : 'false'; ?>">
						<span class="tcp-vote-icon" aria-hidden="true">▲</span>
						<span class="tcp-vote-count"><?php echo esc_html( $votes ); ?></span>
						<span class="tcp-vote-label">vote<?php echo 1 === $votes ? '' : 's'; ?></span>
					</button>
				<?php endif; ?>
			</div>

			<div class="tcp-card-body" hidden>
				<?php if ( $project->post_content ) : ?>
					<h4>The problem</h4>
					<div class="tcp-prose"><?php echo wp_kses_post( wpautop( $project->post_content ) ); ?></div>
				<?php endif; ?>
				<?php if ( $solution ) : ?>
					<h4>Proposed solution</h4>
					<div class="tcp-prose"><?php echo wp_kses_post( wpautop( $solution ) ); ?></div>
				<?php endif; ?>
				<?php if ( $location ) : ?>
					<p class="tcp-loc"><strong>Location:</strong> <?php echo esc_html( $location ); ?></p>
				<?php endif; ?>

				<?php
				$docs = get_post_meta( $id, '_tcp_quote_docs', true );
				if ( is_array( $docs ) && $docs ) : ?>
					<h4>Quote documents</h4>
					<ul class="tcp-docs">
						<?php foreach ( $docs as $att_id ) :
							$att_id = (int) $att_id;
							$url    = wp_get_attachment_url( $att_id );
							if ( ! $url ) {
								continue;
							}
							$name = get_the_title( $att_id ) ? get_the_title( $att_id ) : basename( wp_parse_url( $url, PHP_URL_PATH ) );
							$path = get_attached_file( $att_id );
							$size = ( $path && file_exists( $path ) ) ? filesize( $path ) : 0;
							?>
							<li>
								<a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener">
									<span class="tcp-doc-icon" aria-hidden="true">📄</span>
									<?php echo esc_html( $name ); ?>
									<?php if ( $size ) : ?><span class="tcp-doc-size"><?php echo esc_html( size_format( $size ) ); ?></span><?php endif; ?>
								</a>
							</li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>

				<p class="tcp-updated">Last updated <?php echo esc_html( get_the_modified_date( 'j M Y', $project ) ); ?></p>

				<?php if ( $comments_on ) : ?>
					<div class="tcp-comments" data-id="<?php echo esc_attr( $id ); ?>" data-loaded="0">
						<button type="button" class="tcp-comments-toggle">
							Discussion (<span class="tcp-comment-count"><?php echo esc_html( $comment_count ); ?></span>)
						</button>
						<div class="tcp-comments-panel" hidden>
							<div class="tcp-comments-list"></div>
							<form class="tcp-comment-form">
								<?php if ( ! is_user_logged_in() ) : ?>
									<input type="text" name="author" class="tcp-comment-author" placeholder="Your name" required />
								<?php endif; ?>
								<textarea name="comment" class="tcp-comment-text" rows="3" placeholder="Add a comment on this project" required></textarea>
								<button type="submit" class="tcp-comment-submit">Post comment</button>
								<span class="tcp-comment-note"></span>
							</form>
						</div>
					</div>
				<?php endif; ?>
			</div>
		</article>
		<?php
		return ob_get_clean();
	}

	private function sum_cost( $projects ) {
		$sum = 0.0;
		foreach ( $projects as $p ) {
			$cost = get_post_meta( $p->ID, '_tcp_cost', true );
			if ( '' !== $cost ) {
				$sum += (float) $cost;
			}
		}
		return $sum;
	}

	/* ---------------------------------------------------------------------
	 * Exports (XLS + print-to-PDF)
	 * ------------------------------------------------------------------- */

	/**
	 * Ordered rows for export, one per project, with resolved labels.
	 */
	private function export_rows() {
		$projects = get_posts(
			array(
				'post_type'      => self::CPT,
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'orderby'        => 'menu_order title',
				'order'          => 'ASC',
			)
		);
		$rows = array();
		foreach ( $projects as $p ) {
			$cost   = get_post_meta( $p->ID, '_tcp_cost', true );
			$groups = wp_get_post_terms( $p->ID, self::TAX_GRP, array( 'fields' => 'names' ) );
			$cats   = wp_get_post_terms( $p->ID, self::TAX_CAT, array( 'fields' => 'names' ) );
			$ctype  = get_post_meta( $p->ID, '_tcp_cost_type', true );
			$docs   = get_post_meta( $p->ID, '_tcp_quote_docs', true );
			$rows[] = array(
				'ref'       => get_post_meta( $p->ID, '_tcp_ref', true ),
				'title'     => get_the_title( $p ),
				'category'  => ! is_wp_error( $cats ) && $cats ? implode( ', ', $cats ) : '',
				'programme' => ! is_wp_error( $groups ) && $groups ? implode( ', ', $groups ) : '',
				'priority'  => self::priority_label( get_post_meta( $p->ID, '_tcp_priority', true ) ),
				'status'    => self::status_label( get_post_meta( $p->ID, '_tcp_status', true ) ),
				'cost'      => ( '' === $cost ) ? null : (float) $cost,
				'cost_type' => ( $ctype && isset( self::cost_types()[ $ctype ] ) ) ? self::cost_types()[ $ctype ] : '',
				'location'  => get_post_meta( $p->ID, '_tcp_location', true ),
				'votes'     => (int) get_post_meta( $p->ID, '_tcp_votes', true ),
				'has_quote' => ( is_array( $docs ) && $docs ) ? 'Yes' : 'No',
				'problem'   => wp_strip_all_tags( $p->post_content ),
				'solution'  => get_post_meta( $p->ID, '_tcp_solution', true ),
				'updated'   => get_the_modified_date( 'j M Y', $p ),
			);
		}
		return $rows;
	}

	public function maybe_export() {
		if ( empty( $_GET['tcp_export'] ) ) {
			return;
		}
		$type = sanitize_key( wp_unslash( $_GET['tcp_export'] ) );
		if ( 'xls' === $type ) {
			$this->export_xls();
		} elseif ( 'pdf' === $type ) {
			$this->export_print();
		}
	}

	private function export_columns() {
		return array(
			'ref'       => 'Ref',
			'title'     => 'Project',
			'category'  => 'Category',
			'programme' => 'Programme',
			'priority'  => 'Priority',
			'status'    => 'Status',
			'cost'      => 'Cost (£)',
			'cost_type' => 'Cost basis',
			'has_quote' => 'Quote on file',
			'votes'     => 'Votes',
			'location'  => 'Location',
			'problem'   => 'Problem',
			'solution'  => 'Proposed solution',
			'updated'   => 'Last updated',
		);
	}

	/**
	 * Stream a formatted spreadsheet. An HTML table with the Excel MIME type
	 * opens natively in Excel, Numbers and Google Sheets with header styling
	 * intact, and needs no bundled library.
	 */
	private function export_xls() {
		$rows    = $this->export_rows();
		$cols    = $this->export_columns();
		$total   = 0.0;
		foreach ( $rows as $r ) {
			$total += (float) $r['cost'];
		}
		$file = 'trinity-court-works-' . gmdate( 'Y-m-d' ) . '.xls';

		nocache_headers();
		header( 'Content-Type: application/vnd.ms-excel; charset=UTF-8' );
		header( 'Content-Disposition: attachment; filename="' . $file . '"' );

		echo "\xEF\xBB\xBF"; // UTF-8 BOM for Excel.
		echo '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>';
		echo '<table border="1" cellspacing="0" cellpadding="4">';
		echo '<tr><td colspan="' . count( $cols ) . '" style="background:#68353a;color:#ffffff;font-size:15px;font-weight:bold">Trinity Court, Margate — Building improvement works (' . esc_html( gmdate( 'j F Y' ) ) . ')</td></tr>';
		echo '<tr>';
		foreach ( $cols as $label ) {
			echo '<th style="background:#68353a;color:#ffffff;text-align:left">' . esc_html( $label ) . '</th>';
		}
		echo '</tr>';
		foreach ( $rows as $r ) {
			echo '<tr>';
			foreach ( $cols as $key => $label ) {
				$val = $r[ $key ];
				if ( 'cost' === $key ) {
					// Real figures stay numeric so Excel can sum them; blanks read as text.
					if ( null === $val ) {
						echo '<td>Awaiting quote</td>';
					} else {
						echo '<td>' . esc_html( number_format( (float) $val, 2, '.', '' ) ) . '</td>';
					}
				} else {
					// Force text so long descriptions and refs are not reinterpreted.
					echo '<td style="mso-number-format:\'\\@\'">' . esc_html( (string) $val ) . '</td>';
				}
			}
			echo '</tr>';
		}
		echo '<tr><td colspan="6" style="font-weight:bold;text-align:right">Total costed</td>';
		echo '<td style="font-weight:bold">' . esc_html( number_format( $total, 2, '.', '' ) ) . '</td>';
		echo '<td colspan="' . ( count( $cols ) - 7 ) . '"></td></tr>';
		echo '</table></body></html>';
		exit;
	}

	/**
	 * Render an A4 print-ready page and trigger the browser's Save-as-PDF.
	 * Keeps formatting under our control without a PDF engine.
	 */
	private function export_print() {
		$rows  = $this->export_rows();
		$total = 0.0;
		$done  = 0;
		foreach ( $rows as $r ) {
			$total += (float) $r['cost'];
			if ( 'Completed' === $r['status'] ) {
				$done++;
			}
		}
		$count = count( $rows );

		nocache_headers();
		header( 'Content-Type: text/html; charset=UTF-8' );
		?>
<!doctype html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trinity Court works — <?php echo esc_html( gmdate( 'j F Y' ) ); ?></title>
<style>
	* { box-sizing: border-box; }
	body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1e1c1d; margin: 0; padding: 28px; font-size: 12px; }
	.head { border-bottom: 3px solid #68353a; padding-bottom: 12px; margin-bottom: 16px; }
	.head h1 { font-size: 20px; margin: 0 0 4px; color: #68353a; }
	.head p { margin: 0; color: #666; font-size: 12px; }
	.totals { margin: 0 0 16px; font-size: 13px; }
	.totals strong { color: #68353a; }
	table { width: 100%; border-collapse: collapse; }
	th, td { border: 1px solid #ddd; padding: 6px 7px; text-align: left; vertical-align: top; }
	th { background: #68353a; color: #fff; font-size: 11px; }
	td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
	tr:nth-child(even) td { background: #faf7f7; }
	.status { font-weight: bold; }
	.awaiting { color: #888; font-style: italic; }
	.foot { margin-top: 16px; font-size: 10px; color: #888; }
	.print-btn { position: fixed; top: 14px; right: 14px; background: #68353a; color: #fff; border: 0; padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
	@media print { .print-btn { display: none; } body { padding: 0; } }
	@page { size: A4 landscape; margin: 14mm; }
</style>
</head>
<body>
	<button class="print-btn" onclick="window.print()">Save as PDF</button>
	<div class="head">
		<h1>Trinity Court, Margate — Building improvement works</h1>
		<p>Prepared <?php echo esc_html( gmdate( 'j F Y' ) ); ?> · <?php echo esc_html( $count ); ?> works logged · <?php echo esc_html( $done ); ?> completed</p>
	</div>
	<p class="totals">Total costed so far: <strong><?php echo esc_html( self::money( $total ) ); ?></strong>. Works without a figure are still awaiting a quote.</p>
	<table>
		<thead>
			<tr>
				<th>Ref</th><th>Project</th><th>Category</th><th>Programme</th>
				<th>Priority</th><th>Status</th><th>Cost</th><th>Basis</th><th>Quote</th><th>Location</th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $rows as $r ) : ?>
				<tr>
					<td><?php echo esc_html( $r['ref'] ); ?></td>
					<td><?php echo esc_html( $r['title'] ); ?></td>
					<td><?php echo esc_html( $r['category'] ); ?></td>
					<td><?php echo esc_html( $r['programme'] ); ?></td>
					<td><?php echo esc_html( $r['priority'] ); ?></td>
					<td class="status"><?php echo esc_html( $r['status'] ); ?></td>
					<td class="num"><?php echo ( null === $r['cost'] ) ? '<span class="awaiting">Awaiting</span>' : esc_html( self::money( $r['cost'] ) ); ?></td>
					<td><?php echo esc_html( $r['cost_type'] ); ?></td>
					<td><?php echo esc_html( $r['has_quote'] ); ?></td>
					<td><?php echo esc_html( $r['location'] ); ?></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>
	<p class="foot">Trinity Court RTM. This record is for resident and managing-agent reference. It is not the official reporting channel; formal matters go to the managing agent directly.</p>
	<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},350);});</script>
</body>
</html>
		<?php
		exit;
	}

	/* ---------------------------------------------------------------------
	 * Voting
	 * ------------------------------------------------------------------- */

	/**
	 * Identifier for the current voter: logged-in user id, or a cookie token.
	 */
	private function voter_token() {
		if ( is_user_logged_in() ) {
			return 'u' . get_current_user_id();
		}
		if ( isset( $_COOKIE['tcp_voter'] ) ) {
			return 'c' . preg_replace( '/[^a-f0-9]/', '', sanitize_text_field( wp_unslash( $_COOKIE['tcp_voter'] ) ) );
		}
		return '';
	}

	private function has_voted( $post_id ) {
		$token = $this->voter_token();
		if ( '' === $token ) {
			return false;
		}
		$voters = get_post_meta( $post_id, '_tcp_voters', true );
		return is_array( $voters ) && in_array( $token, $voters, true );
	}

	public function ajax_vote() {
		check_ajax_referer( 'tcp_public', 'nonce' );

		$post_id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		if ( ! $post_id || self::CPT !== get_post_type( $post_id ) ) {
			wp_send_json_error( array( 'message' => 'Unknown project.' ), 400 );
		}

		// Establish a voter token (set a cookie for anonymous visitors).
		$token = $this->voter_token();
		if ( '' === $token ) {
			$token = 'c' . bin2hex( random_bytes( 16 ) );
			setcookie( 'tcp_voter', substr( $token, 1 ), time() + YEAR_IN_SECONDS, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true );
		}

		$voters = get_post_meta( $post_id, '_tcp_voters', true );
		if ( ! is_array( $voters ) ) {
			$voters = array();
		}

		$idx = array_search( $token, $voters, true );
		if ( false !== $idx ) {
			unset( $voters[ $idx ] );
			$voted = false;
		} else {
			$voters[] = $token;
			$voted    = true;
		}
		$voters = array_values( $voters );

		update_post_meta( $post_id, '_tcp_voters', $voters );
		update_post_meta( $post_id, '_tcp_votes', count( $voters ) );

		wp_send_json_success(
			array(
				'votes' => count( $voters ),
				'voted' => $voted,
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Comments (hidden inside each ticket)
	 * ------------------------------------------------------------------- */

	public function ajax_comment() {
		check_ajax_referer( 'tcp_public', 'nonce' );

		$post_id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		if ( ! $post_id || self::CPT !== get_post_type( $post_id ) ) {
			wp_send_json_error( array( 'message' => 'Unknown project.' ), 400 );
		}
		if ( ! comments_open( $post_id ) ) {
			wp_send_json_error( array( 'message' => 'Comments are closed on this project.' ), 403 );
		}

		$content = isset( $_POST['comment'] ) ? trim( sanitize_textarea_field( wp_unslash( $_POST['comment'] ) ) ) : '';
		if ( '' === $content ) {
			wp_send_json_error( array( 'message' => 'Please write a comment.' ), 400 );
		}

		$user = wp_get_current_user();
		if ( $user->exists() ) {
			$author = $user->display_name;
			$email  = $user->user_email;
			$uid    = $user->ID;
		} else {
			$author = isset( $_POST['author'] ) ? sanitize_text_field( wp_unslash( $_POST['author'] ) ) : '';
			$email  = '';
			$uid    = 0;
			if ( '' === $author ) {
				wp_send_json_error( array( 'message' => 'Please add your name.' ), 400 );
			}
		}

		$commentdata = array(
			'comment_post_ID'      => $post_id,
			'comment_content'      => $content,
			'comment_author'       => $author,
			'comment_author_email' => $email,
			'user_id'              => $uid,
			'comment_type'         => 'comment',
		);

		// Logged-in residents auto-approve; anonymous go to moderation.
		add_filter( 'pre_comment_approved', array( $this, 'approve_logged_in' ), 10, 2 );
		$comment_id = wp_new_comment( wp_slash( $commentdata ), true );
		remove_filter( 'pre_comment_approved', array( $this, 'approve_logged_in' ), 10 );

		if ( is_wp_error( $comment_id ) ) {
			wp_send_json_error( array( 'message' => $comment_id->get_error_message() ), 400 );
		}

		$approved = wp_get_comment_status( $comment_id );

		wp_send_json_success(
			array(
				'approved' => ( 'approved' === $approved ),
				'message'  => ( 'approved' === $approved )
					? 'Comment posted.'
					: 'Thanks. Your comment will appear once approved.',
				'html'     => ( 'approved' === $approved ) ? $this->render_comment( get_comment( $comment_id ) ) : '',
				'count'    => (int) get_comments_number( $post_id ),
			)
		);
	}

	public function approve_logged_in( $approved, $commentdata ) {
		if ( ! empty( $commentdata['user_id'] ) ) {
			return 1;
		}
		return $approved;
	}

	/**
	 * Render the approved comments for one project (used by JS on first open).
	 */
	public function render_comments_html( $post_id ) {
		$comments = get_comments(
			array(
				'post_id' => $post_id,
				'status'  => 'approve',
				'order'   => 'ASC',
			)
		);
		if ( empty( $comments ) ) {
			return '<p class="tcp-no-comments">No comments yet. Start the discussion.</p>';
		}
		$out = '';
		foreach ( $comments as $comment ) {
			$out .= $this->render_comment( $comment );
		}
		return $out;
	}

	private function render_comment( $comment ) {
		return sprintf(
			'<div class="tcp-comment"><div class="tcp-comment-head"><span class="tcp-comment-author">%1$s</span><span class="tcp-comment-date">%2$s</span></div><div class="tcp-comment-body">%3$s</div></div>',
			esc_html( $comment->comment_author ),
			esc_html( get_comment_date( 'j M Y', $comment ) ),
			wp_kses_post( wpautop( $comment->comment_content ) )
		);
	}

	/**
	 * Keep project comments out of the global comment queries (recent comments
	 * widget, comment feeds) so the "hidden inside the ticket" promise holds.
	 */
	public function hide_project_comments_globally( $clauses, $query ) {
		if ( is_admin() ) {
			return $clauses;
		}
		$post_id = isset( $query->query_vars['post_id'] ) ? (int) $query->query_vars['post_id'] : 0;
		// Only filter broad queries, not a targeted single-post fetch.
		if ( $post_id ) {
			return $clauses;
		}
		global $wpdb;
		$clauses['join'] = isset( $clauses['join'] ) ? $clauses['join'] : '';
		// Use our own alias so we never collide with another plugin's posts join.
		if ( false === strpos( $clauses['join'], 'tcp_cp' ) ) {
			$clauses['join'] .= " LEFT JOIN {$wpdb->posts} tcp_cp ON {$wpdb->comments}.comment_post_ID = tcp_cp.ID";
		}
		$clauses['where'] = ( isset( $clauses['where'] ) ? $clauses['where'] : '' ) . $wpdb->prepare( ' AND ( tcp_cp.post_type IS NULL OR tcp_cp.post_type != %s )', self::CPT );
		return $clauses;
	}

	/* ---------------------------------------------------------------------
	 * Helpers
	 * ------------------------------------------------------------------- */

	/**
	 * Format a GBP figure. Whole pounds show no decimals.
	 */
	public static function money( $amount ) {
		$amount   = (float) $amount;
		$decimals = ( floor( $amount ) === $amount ) ? 0 : 2;
		return '£' . number_format( $amount, $decimals );
	}

	/* ---------------------------------------------------------------------
	 * Seeding / import
	 * ------------------------------------------------------------------- */

	public static function activate() {
		$plugin = self::instance();
		$plugin->register_post_type();
		$plugin->register_taxonomies();

		if ( ! get_option( 'tcp_seeded' ) ) {
			$plugin->import_seed();
			update_option( 'tcp_seeded', 1 );
		}
		flush_rewrite_rules();
	}

	/**
	 * Insert the seed groups and projects. Idempotent per-run: skips a project
	 * whose reference already exists.
	 *
	 * @return int number of projects inserted.
	 */
	public function import_seed() {
		// Groups first.
		$group_ids = array();
		foreach ( tcp_seed_groups() as $slug => $data ) {
			$term = term_exists( $slug, self::TAX_GRP );
			if ( ! $term ) {
				$term = wp_insert_term( $data[0], self::TAX_GRP, array( 'slug' => $slug ) );
			}
			if ( ! is_wp_error( $term ) ) {
				$term_id            = is_array( $term ) ? (int) $term['term_id'] : (int) $term;
				$group_ids[ $slug ] = $term_id;
				update_term_meta( $term_id, 'tcp_group_type', $data[1] );
			}
		}

		// Existing refs to avoid duplicates.
		$existing = array();
		$all      = get_posts(
			array(
				'post_type'      => self::CPT,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		foreach ( $all as $pid ) {
			$existing[ get_post_meta( $pid, '_tcp_ref', true ) ] = true;
		}

		$inserted = 0;
		$menu     = 0;
		foreach ( tcp_seed_projects() as $seed ) {
			$menu++;
			if ( isset( $existing[ $seed['ref'] ] ) ) {
				continue;
			}
			$post_id = wp_insert_post(
				array(
					'post_type'    => self::CPT,
					'post_status'  => 'publish',
					'post_title'   => $seed['title'],
					'post_content' => $seed['problem'],
					'menu_order'   => $menu,
					'comment_status' => 'open',
				)
			);
			if ( is_wp_error( $post_id ) || ! $post_id ) {
				continue;
			}

			update_post_meta( $post_id, '_tcp_ref', $seed['ref'] );
			update_post_meta( $post_id, '_tcp_status', $seed['status'] );
			update_post_meta( $post_id, '_tcp_priority', $seed['priority'] );
			update_post_meta( $post_id, '_tcp_location', $seed['location'] );
			update_post_meta( $post_id, '_tcp_solution', $seed['solution'] );
			update_post_meta( $post_id, '_tcp_votes', 0 );

			wp_set_object_terms( $post_id, $seed['category'], self::TAX_CAT );

			if ( ! empty( $seed['groups'] ) ) {
				$term_ids = array();
				foreach ( $seed['groups'] as $gslug ) {
					if ( isset( $group_ids[ $gslug ] ) ) {
						$term_ids[] = $group_ids[ $gslug ];
					}
				}
				if ( $term_ids ) {
					wp_set_object_terms( $post_id, $term_ids, self::TAX_GRP );
				}
			}
			$inserted++;
		}
		return $inserted;
	}

	public function admin_import_page() {
		add_submenu_page(
			'edit.php?post_type=' . self::CPT,
			'Import seed list',
			'Import seed list',
			'manage_options',
			'tcp-import',
			array( $this, 'render_import_page' )
		);
	}

	public function render_import_page() {
		if ( isset( $_POST['tcp_do_import'] ) && check_admin_referer( 'tcp_import' ) ) {
			$count = $this->import_seed();
			update_option( 'tcp_seeded', 1 );
			printf( '<div class="notice notice-success"><p>Imported %d new project(s). Existing references were left untouched.</p></div>', (int) $count );
		}
		?>
		<div class="wrap">
			<h1>Import seed list</h1>
			<p>This loads the 25 building improvement items from the RTM board's works list. Items are matched by reference number, so running it again only adds any that are missing; it will not duplicate or overwrite existing projects.</p>
			<form method="post">
				<?php wp_nonce_field( 'tcp_import' ); ?>
				<p><button type="submit" name="tcp_do_import" class="button button-primary">Import / top up seed list</button></p>
			</form>
		</div>
		<?php
	}

	public function maybe_seed_notice() {
		$screen = get_current_screen();
		if ( ! $screen || self::CPT !== $screen->post_type ) {
			return;
		}
		$count = wp_count_posts( self::CPT );
		if ( isset( $count->publish ) && 0 === (int) $count->publish && ! get_option( 'tcp_seeded' ) ) {
			$url = admin_url( 'edit.php?post_type=' . self::CPT . '&page=tcp-import' );
			printf(
				'<div class="notice notice-info"><p>No projects yet. <a href="%s">Import the RTM works list</a> to get started.</p></div>',
				esc_url( $url )
			);
		}
	}
}

/**
 * Extra AJAX: fetch a project's comments HTML on first expand.
 */
add_action(
	'wp_ajax_tcp_get_comments',
	function () {
		check_ajax_referer( 'tcp_public', 'nonce' );
		$post_id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		if ( ! $post_id || Trinity_Court_Projects::CPT !== get_post_type( $post_id ) ) {
			wp_send_json_error( array( 'message' => 'Unknown project.' ), 400 );
		}
		wp_send_json_success( array( 'html' => Trinity_Court_Projects::instance()->render_comments_html( $post_id ) ) );
	}
);
add_action(
	'wp_ajax_nopriv_tcp_get_comments',
	function () {
		check_ajax_referer( 'tcp_public', 'nonce' );
		$post_id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
		if ( ! $post_id || Trinity_Court_Projects::CPT !== get_post_type( $post_id ) ) {
			wp_send_json_error( array( 'message' => 'Unknown project.' ), 400 );
		}
		wp_send_json_success( array( 'html' => Trinity_Court_Projects::instance()->render_comments_html( $post_id ) ) );
	}
);

Trinity_Court_Projects::instance();

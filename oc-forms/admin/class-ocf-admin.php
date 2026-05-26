<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	public static function menu() {
		add_menu_page(
			'October Forms',
			'October Forms',
			'manage_options',
			'oc-forms',
			array( __CLASS__, 'render_forms_list' ),
			'dashicons-feedback',
			32
		);

		add_submenu_page( 'oc-forms', 'All Forms', 'All Forms', 'manage_options', 'oc-forms', array( __CLASS__, 'render_forms_list' ) );
		add_submenu_page( 'oc-forms', 'Add New', 'Add New', 'manage_options', 'post-new.php?post_type=' . OCF_CPT );
		add_submenu_page( 'oc-forms', 'Submissions', 'Submissions', 'manage_options', 'oc-forms-submissions', array( 'OCF_Submissions_List', 'render' ) );
		add_submenu_page( 'oc-forms', 'Settings', 'Settings', 'manage_options', 'oc-forms-settings', array( 'OCF_Settings', 'render' ) );

		// Hide the auto-added "All Forms" duplicate from the CPT.
		add_submenu_page( 'oc-forms', 'Edit Form', 'Edit Form', 'manage_options', 'oc-form-edit', '__return_null' );
		remove_submenu_page( 'oc-forms', 'oc-form-edit' );
	}

	public static function assets( $hook ) {
		// Builder loads on the CPT edit screen.
		global $post;
		if ( ( $hook === 'post.php' || $hook === 'post-new.php' ) && $post && get_post_type( $post ) === OCF_CPT ) {
			wp_enqueue_style( 'ocf-builder', OCF_URL . 'assets/css/builder.css', array(), OCF_VERSION );
			wp_enqueue_media();
			wp_enqueue_script( 'ocf-builder', OCF_URL . 'assets/js/builder.js', array( 'jquery' ), OCF_VERSION, true );
		}
		// Admin-wide.
		if ( strpos( (string) ( $_GET['page'] ?? '' ), 'oc-forms' ) !== false ) {
			wp_enqueue_style( 'ocf-admin', OCF_URL . 'assets/css/admin.css', array(), OCF_VERSION );
		}
	}

	public static function render_forms_list() {
		$forms = get_posts( array(
			'post_type'      => OCF_CPT,
			'posts_per_page' => 50,
			'post_status'    => array( 'publish', 'draft' ),
		) );
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">October Forms</h1>
			<a href="<?php echo esc_url( admin_url( 'post-new.php?post_type=' . OCF_CPT ) ); ?>" class="page-title-action">Add New</a>
			<hr class="wp-header-end">
			<table class="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th>Title</th>
						<th>Shortcode</th>
						<th>Status</th>
						<th>Submissions</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
				<?php if ( empty( $forms ) ) : ?>
					<tr><td colspan="5">No forms yet. <a href="<?php echo esc_url( admin_url( 'post-new.php?post_type=' . OCF_CPT ) ); ?>">Create your first form</a>.</td></tr>
				<?php else : foreach ( $forms as $f ) :
					$count = OCF_Submission::count_for_form( $f->ID, 'complete' );
					$partial = OCF_Submission::count_for_form( $f->ID, 'partial' );
				?>
					<tr>
						<td><strong><a href="<?php echo esc_url( get_edit_post_link( $f->ID ) ); ?>"><?php echo esc_html( $f->post_title ); ?></a></strong></td>
						<td><code>[oc_form id="<?php echo (int) $f->ID; ?>"]</code></td>
						<td><?php echo esc_html( ucfirst( $f->post_status ) ); ?></td>
						<td><?php echo (int) $count; ?> complete · <?php echo (int) $partial; ?> partial</td>
						<td>
							<a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=oc-forms-submissions&form_id=' . $f->ID ) ); ?>">Submissions</a>
							<a class="button" href="<?php echo esc_url( get_edit_post_link( $f->ID ) ); ?>">Edit</a>
						</td>
					</tr>
				<?php endforeach; endif; ?>
				</tbody>
			</table>
		</div>
		<?php
	}
}

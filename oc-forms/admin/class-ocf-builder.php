<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Builder {

	public static function init() {
		add_action( 'edit_form_after_title',       array( __CLASS__, 'render_builder' ) );
		add_action( 'save_post_' . OCF_CPT,        array( __CLASS__, 'save' ), 10, 2 );
		add_action( 'add_meta_boxes_' . OCF_CPT,   array( __CLASS__, 'meta_boxes' ) );
		add_filter( 'manage_' . OCF_CPT . '_posts_columns', array( __CLASS__, 'columns' ) );
		add_action( 'manage_' . OCF_CPT . '_posts_custom_column', array( __CLASS__, 'render_column' ), 10, 2 );
	}

	public static function columns( $cols ) {
		$cols['shortcode']   = 'Shortcode';
		$cols['submissions'] = 'Submissions';
		return $cols;
	}

	public static function render_column( $col, $post_id ) {
		if ( $col === 'shortcode' ) {
			echo '<code>[oc_form id="' . (int) $post_id . '"]</code>';
		} elseif ( $col === 'submissions' ) {
			$c = OCF_Submission::count_for_form( $post_id, 'complete' );
			$p = OCF_Submission::count_for_form( $post_id, 'partial' );
			echo (int) $c . ' / ' . (int) $p . ' partial';
		}
	}

	public static function meta_boxes() {
		remove_post_type_support( OCF_CPT, 'editor' );
		add_meta_box( 'ocf-help', 'Embed', array( __CLASS__, 'render_help' ), OCF_CPT, 'side', 'high' );
	}

	public static function render_help( $post ) {
		echo '<p><strong>Shortcode:</strong></p>';
		echo '<p><code>[oc_form id="' . (int) $post->ID . '"]</code></p>';
		echo '<p>Or use the <em>OC Form</em> block.</p>';
		echo '<p><a href="' . esc_url( admin_url( 'admin.php?page=oc-forms-submissions&form_id=' . $post->ID ) ) . '">View submissions →</a></p>';
	}

	public static function render_builder( $post ) {
		if ( get_post_type( $post ) !== OCF_CPT ) { return; }

		$schema = OCF_Schema::get( $post->ID );
		$config = array(
			'formId'   => (int) $post->ID,
			'schema'   => $schema,
			'types'    => OCF_Schema::types(),
			'nonce'    => wp_create_nonce( 'ocf_save_schema_' . $post->ID ),
			'restUrl'  => esc_url_raw( rest_url( OCF_REST_API::NAMESPACE . '/' ) ),
		);
		?>
		<div id="ocf-builder"
			 data-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>">
			<noscript>Builder requires JavaScript.</noscript>
			<div class="ocf-builder-loading">Loading form builder…</div>
		</div>
		<input type="hidden" name="ocf_schema_json" id="ocf_schema_json" value="">
		<?php wp_nonce_field( 'ocf_save_schema_' . $post->ID, 'ocf_builder_nonce' ); ?>
		<?php
	}

	public static function save( $post_id, $post ) {
		if ( ! isset( $_POST['ocf_builder_nonce'] ) ) { return; }
		if ( ! wp_verify_nonce( $_POST['ocf_builder_nonce'], 'ocf_save_schema_' . $post_id ) ) { return; }
		if ( ! current_user_can( 'edit_post', $post_id ) ) { return; }
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) { return; }

		$raw = isset( $_POST['ocf_schema_json'] ) ? wp_unslash( $_POST['ocf_schema_json'] ) : '';
		if ( ! $raw ) { return; }
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) { return; }
		OCF_Schema::save( $post_id, $decoded );
	}
}

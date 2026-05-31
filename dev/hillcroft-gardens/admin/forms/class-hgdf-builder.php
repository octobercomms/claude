<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_Builder {

	public static function init() {
		add_action( 'edit_form_after_title',       array( __CLASS__, 'render_builder' ) );
		add_action( 'save_post_' . HGDF_CPT,        array( __CLASS__, 'save' ), 10, 2 );
		add_action( 'add_meta_boxes_' . HGDF_CPT,   array( __CLASS__, 'meta_boxes' ) );
		add_filter( 'manage_' . HGDF_CPT . '_posts_columns', array( __CLASS__, 'columns' ) );
		add_action( 'manage_' . HGDF_CPT . '_posts_custom_column', array( __CLASS__, 'render_column' ), 10, 2 );
	}

	public static function columns( $cols ) {
		$cols['shortcode']   = 'Shortcode';
		$cols['submissions'] = 'Submissions';
		return $cols;
	}

	public static function render_column( $col, $post_id ) {
		if ( $col === 'shortcode' ) {
			echo '<code>[hgd_form id="' . (int) $post_id . '"]</code>';
		} elseif ( $col === 'submissions' ) {
			$c = HGDF_Submission::count_for_form( $post_id, 'complete' );
			$p = HGDF_Submission::count_for_form( $post_id, 'partial' );
			echo (int) $c . ' / ' . (int) $p . ' partial';
		}
	}

	public static function meta_boxes() {
		remove_post_type_support( HGDF_CPT, 'editor' );
		add_meta_box( 'hgd-form-help', 'Embed', array( __CLASS__, 'render_help' ), HGDF_CPT, 'side', 'high' );
	}

	public static function render_help( $post ) {
		echo '<p><strong>Shortcode:</strong></p>';
		echo '<p><code>[hgd_form id="' . (int) $post->ID . '"]</code></p>';
		echo '<p>Or use the <em>nvelope Form</em> block.</p>';
		echo '<p><a href="' . esc_url( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $post->ID ) ) . '">View submissions →</a></p>';
	}

	public static function render_builder( $post ) {
		if ( get_post_type( $post ) !== HGDF_CPT ) { return; }

		$schema = HGDF_Schema::get( $post->ID );
		$config = array(
			'formId'   => (int) $post->ID,
			'schema'   => $schema,
			'types'    => HGDF_Schema::types(),
			'nonce'    => wp_create_nonce( 'hgd_form_save_schema_' . $post->ID ),
			'restUrl'  => esc_url_raw( rest_url( HGDF_REST_API::NAMESPACE . '/' ) ),
		);
		?>
		<div id="hgd-form-builder"
			 data-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>">
			<noscript>Builder requires JavaScript.</noscript>
			<div class="hgd-form-builder-loading">Loading form builder…</div>
		</div>
		<input type="hidden" name="hgd_form_schema_json" id="hgd_form_schema_json" value="">
		<?php wp_nonce_field( 'hgd_form_save_schema_' . $post->ID, 'hgd_form_builder_nonce' ); ?>
		<?php
	}

	public static function save( $post_id, $post ) {
		if ( ! isset( $_POST['hgd_form_builder_nonce'] ) ) { return; }
		if ( ! wp_verify_nonce( $_POST['hgd_form_builder_nonce'], 'hgd_form_save_schema_' . $post_id ) ) { return; }
		if ( ! current_user_can( 'edit_post', $post_id ) ) { return; }
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) { return; }

		$raw = isset( $_POST['hgd_form_schema_json'] ) ? wp_unslash( $_POST['hgd_form_schema_json'] ) : '';
		if ( ! $raw ) { return; }
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) { return; }
		HGDF_Schema::save( $post_id, $decoded );
	}
}

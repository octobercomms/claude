<?php
defined( 'ABSPATH' ) || exit;

/**
 * Registers a meta box on product edit screens for managing swatch groups.
 *
 * Data shape stored in post meta '_fabric_swatch_groups':
 *   [ { title, description, price_label, swatches: [ { name, fabric_image_id, product_image_id, price_label } ] } ]
 *
 * fabric_image_id  – small tile shown inside the drawer (thumbnail size)
 * product_image_id – full hero photo shown in the main WooCommerce gallery on selection
 */
class WC_Fabric_Swatches_Admin {

	public function __construct() {
		add_action( 'add_meta_boxes', [ $this, 'add_meta_box' ] );
		add_action( 'save_post_product', [ $this, 'save_meta_box' ], 10, 2 );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
	}

	// -------------------------------------------------------------------------
	// Scripts & styles
	// -------------------------------------------------------------------------

	public function enqueue_scripts( $hook ) {
		global $post;

		if ( ! in_array( $hook, [ 'post.php', 'post-new.php' ], true ) ) {
			return;
		}
		if ( ! $post || 'product' !== $post->post_type ) {
			return;
		}

		wp_enqueue_media();

		wp_enqueue_style(
			'wc-fabric-swatches-admin',
			WC_FABRIC_SWATCHES_URL . 'assets/css/admin.css',
			[],
			WC_FABRIC_SWATCHES_VERSION
		);

		wp_enqueue_script(
			'wc-fabric-swatches-admin',
			WC_FABRIC_SWATCHES_URL . 'assets/js/admin.js',
			[ 'jquery', 'wp-util' ],
			WC_FABRIC_SWATCHES_VERSION,
			true
		);

		wp_localize_script( 'wc-fabric-swatches-admin', 'wcFabricSwatchesAdmin', [
			'chooseImage'    => __( 'Choose Image', 'wc-fabric-swatches' ),
			'chooseImageBtn' => __( 'Use this image', 'wc-fabric-swatches' ),
			'confirmRemove'  => __( 'Remove this swatch group and all its swatches?', 'wc-fabric-swatches' ),
		] );
	}

	// -------------------------------------------------------------------------
	// Meta box registration
	// -------------------------------------------------------------------------

	public function add_meta_box() {
		add_meta_box(
			'wc_fabric_swatches',
			__( 'Fabric Swatches', 'wc-fabric-swatches' ),
			[ $this, 'render_meta_box' ],
			'product',
			'normal',
			'high'
		);
	}

	// -------------------------------------------------------------------------
	// Meta box render
	// -------------------------------------------------------------------------

	public function render_meta_box( $post ) {
		$groups = get_post_meta( $post->ID, '_fabric_swatch_groups', true );
		if ( ! is_array( $groups ) ) {
			$groups = [];
		}

		wp_nonce_field( 'wc_fabric_swatches_save', 'wc_fabric_swatches_nonce' );
		?>
		<div id="wc-fabric-swatches-groups" class="wc-fabric-swatches-groups">
			<?php foreach ( $groups as $gi => $group ) : ?>
				<?php $this->render_group( $gi, $group ); ?>
			<?php endforeach; ?>
		</div>

		<button type="button" class="button wc-fabric-swatches-add-group">
			<?php esc_html_e( '+ Add Swatch Group', 'wc-fabric-swatches' ); ?>
		</button>

		<!-- Underscore templates (rendered server-side, interpolated by JS) -->
		<script type="text/html" id="tmpl-swatch-group">
			<?php $this->render_group( '{{data.groupIndex}}', [] ); ?>
		</script>
		<script type="text/html" id="tmpl-swatch-item">
			<?php $this->render_swatch( '{{data.groupIndex}}', '{{data.swatchIndex}}', [] ); ?>
		</script>
		<?php
	}

	// -------------------------------------------------------------------------
	// Render helpers
	// -------------------------------------------------------------------------

	private function render_group( $gi, $group ) {
		$title       = $group['title'] ?? '';
		$description = $group['description'] ?? '';
		$price_label = $group['price_label'] ?? '';
		$swatches    = $group['swatches'] ?? [];
		?>
		<div class="wc-fabric-swatches-group" data-group-index="<?php echo esc_attr( $gi ); ?>">
			<div class="wc-fabric-swatches-group-header">
				<span class="wc-fabric-swatches-group-title-display">
					<?php echo $title ? esc_html( $title ) : esc_html__( 'New Group', 'wc-fabric-swatches' ); ?>
				</span>
				<span class="wc-fabric-swatches-group-actions">
					<button type="button" class="button-link wc-fabric-swatches-toggle-group">
						<?php esc_html_e( 'Toggle', 'wc-fabric-swatches' ); ?>
					</button>
					<button type="button" class="button-link-delete wc-fabric-swatches-remove-group">
						<?php esc_html_e( 'Remove', 'wc-fabric-swatches' ); ?>
					</button>
				</span>
			</div>

			<div class="wc-fabric-swatches-group-body">
				<div class="wc-fabric-swatches-group-fields">
					<div class="wc-fabric-swatches-field">
						<label><?php esc_html_e( 'Group Title', 'wc-fabric-swatches' ); ?></label>
						<input type="text"
							name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][title]"
							value="<?php echo esc_attr( $title ); ?>"
							class="wc-fabric-swatches-group-title-input regular-text"
							placeholder="<?php esc_attr_e( 'e.g. Premium Velvets', 'wc-fabric-swatches' ); ?>">
					</div>
					<div class="wc-fabric-swatches-field">
						<label><?php esc_html_e( 'Price Label', 'wc-fabric-swatches' ); ?></label>
						<input type="text"
							name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][price_label]"
							value="<?php echo esc_attr( $price_label ); ?>"
							class="regular-text"
							placeholder="<?php esc_attr_e( 'e.g. From £X  or  Premium', 'wc-fabric-swatches' ); ?>">
					</div>
					<div class="wc-fabric-swatches-field wc-fabric-swatches-field--full">
						<label><?php esc_html_e( 'Group Description', 'wc-fabric-swatches' ); ?></label>
						<textarea
							name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][description]"
							rows="2"
							class="large-text"
							placeholder="<?php esc_attr_e( 'Optional short description of this fabric category', 'wc-fabric-swatches' ); ?>"><?php echo esc_textarea( $description ); ?></textarea>
					</div>
				</div>

				<div class="wc-fabric-swatches-swatches-list">
					<?php foreach ( $swatches as $si => $swatch ) : ?>
						<?php $this->render_swatch( $gi, $si, $swatch ); ?>
					<?php endforeach; ?>
				</div>

				<button type="button" class="button wc-fabric-swatches-add-swatch"
					data-group="<?php echo esc_attr( $gi ); ?>">
					<?php esc_html_e( '+ Add Swatch', 'wc-fabric-swatches' ); ?>
				</button>
			</div>
		</div>
		<?php
	}

	private function render_swatch( $gi, $si, $swatch ) {
		$name           = $swatch['name'] ?? '';
		$fabric_img_id  = $swatch['fabric_image_id'] ?? '';
		$product_img_id = $swatch['product_image_id'] ?? '';
		$price_label    = $swatch['price_label'] ?? '';

		$fabric_img_url  = $fabric_img_id  ? wp_get_attachment_image_url( (int) $fabric_img_id,  'thumbnail' ) : '';
		$product_img_url = $product_img_id ? wp_get_attachment_image_url( (int) $product_img_id, 'thumbnail' ) : '';
		?>
		<div class="wc-fabric-swatch-item" data-swatch-index="<?php echo esc_attr( $si ); ?>">
			<div class="wc-fabric-swatch-item-inner">

				<!-- Fabric tile image -->
				<div class="wc-fabric-swatch-image-field">
					<span class="wc-fabric-swatch-image-label">
						<?php esc_html_e( 'Fabric Tile', 'wc-fabric-swatches' ); ?>
					</span>
					<div class="wc-fabric-swatch-image-wrap">
						<?php if ( $fabric_img_url ) : ?>
							<img src="<?php echo esc_url( $fabric_img_url ); ?>" alt="">
						<?php endif; ?>
					</div>
					<input type="hidden"
						name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][swatches][<?php echo esc_attr( $si ); ?>][fabric_image_id]"
						value="<?php echo esc_attr( $fabric_img_id ); ?>"
						class="wc-fabric-swatch-image-id">
					<div class="wc-fabric-swatch-image-buttons">
						<button type="button" class="button button-small wc-fabric-swatch-upload-image" data-type="fabric">
							<?php esc_html_e( 'Select', 'wc-fabric-swatches' ); ?>
						</button>
						<button type="button" class="button button-small wc-fabric-swatch-remove-image<?php echo $fabric_img_id ? '' : ' hidden'; ?>" data-type="fabric">
							<?php esc_html_e( 'Remove', 'wc-fabric-swatches' ); ?>
						</button>
					</div>
				</div>

				<!-- Product hero image -->
				<div class="wc-fabric-swatch-image-field">
					<span class="wc-fabric-swatch-image-label">
						<?php esc_html_e( 'Product Photo', 'wc-fabric-swatches' ); ?>
					</span>
					<div class="wc-fabric-swatch-image-wrap">
						<?php if ( $product_img_url ) : ?>
							<img src="<?php echo esc_url( $product_img_url ); ?>" alt="">
						<?php endif; ?>
					</div>
					<input type="hidden"
						name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][swatches][<?php echo esc_attr( $si ); ?>][product_image_id]"
						value="<?php echo esc_attr( $product_img_id ); ?>"
						class="wc-fabric-swatch-product-image-id">
					<div class="wc-fabric-swatch-image-buttons">
						<button type="button" class="button button-small wc-fabric-swatch-upload-image" data-type="product">
							<?php esc_html_e( 'Select', 'wc-fabric-swatches' ); ?>
						</button>
						<button type="button" class="button button-small wc-fabric-swatch-remove-image<?php echo $product_img_id ? '' : ' hidden'; ?>" data-type="product">
							<?php esc_html_e( 'Remove', 'wc-fabric-swatches' ); ?>
						</button>
					</div>
				</div>

				<!-- Text fields -->
				<div class="wc-fabric-swatch-fields">
					<label class="wc-fabric-swatch-field-label">
						<?php esc_html_e( 'Fabric Name', 'wc-fabric-swatches' ); ?>
					</label>
					<input type="text"
						name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][swatches][<?php echo esc_attr( $si ); ?>][name]"
						value="<?php echo esc_attr( $name ); ?>"
						placeholder="<?php esc_attr_e( 'e.g. Dark Olive Velvet', 'wc-fabric-swatches' ); ?>"
						class="regular-text">

					<label class="wc-fabric-swatch-field-label">
						<?php esc_html_e( 'Price Label (optional)', 'wc-fabric-swatches' ); ?>
					</label>
					<input type="text"
						name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][swatches][<?php echo esc_attr( $si ); ?>][price_label]"
						value="<?php echo esc_attr( $price_label ); ?>"
						placeholder="<?php esc_attr_e( 'e.g. +£200', 'wc-fabric-swatches' ); ?>"
						class="regular-text">

					<button type="button" class="button-link-delete wc-fabric-swatch-remove">
						<?php esc_html_e( 'Remove swatch', 'wc-fabric-swatches' ); ?>
					</button>
				</div>

			</div>
		</div>
		<?php
	}

	// -------------------------------------------------------------------------
	// Save
	// -------------------------------------------------------------------------

	public function save_meta_box( $post_id ) {
		if ( ! isset( $_POST['wc_fabric_swatches_nonce'] ) ) {
			return;
		}
		if ( ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['wc_fabric_swatches_nonce'] ) ), 'wc_fabric_swatches_save' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$groups = [];

		$raw = isset( $_POST['fabric_swatch_groups'] ) ? wp_unslash( $_POST['fabric_swatch_groups'] ) : []; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

		if ( is_array( $raw ) ) {
			foreach ( $raw as $group_data ) {
				$group = [
					'title'       => sanitize_text_field( $group_data['title'] ?? '' ),
					'description' => sanitize_textarea_field( $group_data['description'] ?? '' ),
					'price_label' => sanitize_text_field( $group_data['price_label'] ?? '' ),
					'swatches'    => [],
				];

				if ( ! empty( $group_data['swatches'] ) && is_array( $group_data['swatches'] ) ) {
					foreach ( $group_data['swatches'] as $s ) {
						$group['swatches'][] = [
							'name'             => sanitize_text_field( $s['name'] ?? '' ),
							'fabric_image_id'  => absint( $s['fabric_image_id'] ?? 0 ),
							'product_image_id' => absint( $s['product_image_id'] ?? 0 ),
							'price_label'      => sanitize_text_field( $s['price_label'] ?? '' ),
						];
					}
				}

				$groups[] = $group;
			}
		}

		update_post_meta( $post_id, '_fabric_swatch_groups', $groups );
	}
}

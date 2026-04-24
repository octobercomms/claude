<?php
defined( 'ABSPATH' ) || exit;

/**
 * Admin meta box for the Fabric Swatches plugin.
 *
 * Admin picks which product attribute (e.g. pa_colour) contains the fabric
 * options, then organises those attribute terms into named groups. Term images
 * and colours are read from WooCommerce / CartFlows term meta — no separate
 * image uploads required.
 *
 * Saved post meta:
 *   _fabric_swatch_attribute  string  e.g. 'pa_colour'
 *   _fabric_swatch_groups     array   [ { title, description, price_label,
 *                                         term_slugs: [] }, ... ]
 */
class WC_Fabric_Swatches_Admin {

	public function __construct() {
		add_action( 'add_meta_boxes', [ $this, 'add_meta_box' ] );
		add_action( 'save_post_product', [ $this, 'save_meta_box' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
	}

	// -------------------------------------------------------------------------
	// Scripts
	// -------------------------------------------------------------------------

	public function enqueue_scripts( $hook ) {
		global $post;

		if ( ! in_array( $hook, [ 'post.php', 'post-new.php' ], true ) ) {
			return;
		}
		if ( ! $post || 'product' !== $post->post_type ) {
			return;
		}

		wp_enqueue_style(
			'wc-fabric-swatches-admin',
			WC_FABRIC_SWATCHES_URL . 'assets/css/admin.css',
			[],
			WC_FABRIC_SWATCHES_VERSION
		);

		wp_enqueue_script(
			'wc-fabric-swatches-admin',
			WC_FABRIC_SWATCHES_URL . 'assets/js/admin.js',
			[ 'jquery' ],
			WC_FABRIC_SWATCHES_VERSION,
			true
		);

		$product = wc_get_product( $post->ID );

		$selected_attr = get_post_meta( $post->ID, '_fabric_swatch_attribute', true );

		wp_localize_script( 'wc-fabric-swatches-admin', 'wcFabricSwatchesAdmin', [
			'attributes'        => $this->get_attribute_data( $product ),
			'selectedAttribute' => $selected_attr ?: '',
			'confirmChangeAttr' => __( 'Changing the attribute will reset term assignments. Continue?', 'wc-fabric-swatches' ),
			'confirmRemove'     => __( 'Remove this group?', 'wc-fabric-swatches' ),
			'noTerms'           => __( 'No terms available for this attribute.', 'wc-fabric-swatches' ),
			'termsLabel'        => __( 'Fabrics in this group:', 'wc-fabric-swatches' ),
		] );
	}

	// -------------------------------------------------------------------------
	// Meta box
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

	public function render_meta_box( $post ) {
		$product = wc_get_product( $post->ID );

		if ( ! $product ) {
			echo '<p>' . esc_html__( 'Save the product first, then configure swatches.', 'wc-fabric-swatches' ) . '</p>';
			return;
		}

		$attributes    = $this->get_attribute_data( $product );
		$selected_attr = get_post_meta( $post->ID, '_fabric_swatch_attribute', true );
		$groups        = get_post_meta( $post->ID, '_fabric_swatch_groups', true );
		if ( ! is_array( $groups ) ) {
			$groups = [];
		}

		// Terms for the currently selected attribute (used for checkbox rendering)
		$attr_terms = isset( $attributes[ $selected_attr ] ) ? $attributes[ $selected_attr ]['terms'] : [];

		wp_nonce_field( 'wc_fabric_swatches_save', 'wc_fabric_swatches_nonce' );
		?>

		<div id="wc-fabric-swatches-root">

			<?php if ( empty( $attributes ) ) : ?>
				<p class="description">
					<?php esc_html_e( 'No taxonomy attributes found on this product. Add a global attribute (e.g. Fabric, Colour) under the Attributes tab first.', 'wc-fabric-swatches' ); ?>
				</p>
			<?php else : ?>

				<div class="wc-fabric-swatches-attr-row">
					<label for="fabric-swatch-attribute">
						<strong><?php esc_html_e( 'Fabric Attribute', 'wc-fabric-swatches' ); ?></strong>
					</label>
					<select name="fabric_swatch_attribute" id="fabric-swatch-attribute">
						<option value=""><?php esc_html_e( '— Select attribute —', 'wc-fabric-swatches' ); ?></option>
						<?php foreach ( $attributes as $taxonomy => $info ) : ?>
							<option value="<?php echo esc_attr( $taxonomy ); ?>" <?php selected( $selected_attr, $taxonomy ); ?>>
								<?php echo esc_html( $info['label'] ); ?>
							</option>
						<?php endforeach; ?>
					</select>
					<p class="description">
						<?php esc_html_e( 'Which attribute holds the fabric / colour options you want shown in the drawer.', 'wc-fabric-swatches' ); ?>
					</p>
				</div>

				<div id="wc-fabric-swatches-groups">
					<?php foreach ( $groups as $gi => $group ) : ?>
						<?php $this->render_group( $gi, $group, $attr_terms ); ?>
					<?php endforeach; ?>
				</div>

				<button type="button" id="wc-fabric-swatches-add-group" class="button"
					<?php echo $selected_attr ? '' : 'style="display:none"'; ?>>
					<?php esc_html_e( '+ Add Group', 'wc-fabric-swatches' ); ?>
				</button>

			<?php endif; ?>

		</div>
		<?php
	}

	// -------------------------------------------------------------------------
	// Render helpers
	// -------------------------------------------------------------------------

	public function render_group( $gi, $group, $attr_terms ) {
		$title       = $group['title'] ?? '';
		$description = $group['description'] ?? '';
		$price_label = $group['price_label'] ?? '';
		$term_slugs  = $group['term_slugs'] ?? [];
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
							placeholder="<?php esc_attr_e( 'e.g. Category A', 'wc-fabric-swatches' ); ?>">
					</div>
					<div class="wc-fabric-swatches-field">
						<label><?php esc_html_e( 'Price Label', 'wc-fabric-swatches' ); ?></label>
						<input type="text"
							name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][price_label]"
							value="<?php echo esc_attr( $price_label ); ?>"
							class="regular-text"
							placeholder="<?php esc_attr_e( 'e.g. From £X', 'wc-fabric-swatches' ); ?>">
					</div>
					<div class="wc-fabric-swatches-field wc-fabric-swatches-field--full">
						<label><?php esc_html_e( 'Description', 'wc-fabric-swatches' ); ?></label>
						<textarea
							name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][description]"
							rows="2" class="large-text"
							placeholder="<?php esc_attr_e( 'Optional description for this fabric category', 'wc-fabric-swatches' ); ?>"><?php echo esc_textarea( $description ); ?></textarea>
					</div>
				</div>

				<div class="wc-fabric-swatches-terms-list">
					<?php $this->render_term_checkboxes( $gi, $attr_terms, $term_slugs ); ?>
				</div>
			</div>

		</div>
		<?php
	}

	public function render_term_checkboxes( $gi, $attr_terms, $selected_slugs ) {
		if ( empty( $attr_terms ) ) {
			echo '<p class="description">' . esc_html__( 'Select an attribute above to see available terms.', 'wc-fabric-swatches' ) . '</p>';
			return;
		}
		?>
		<p class="wc-fabric-swatches-terms-label">
			<?php esc_html_e( 'Fabrics in this group:', 'wc-fabric-swatches' ); ?>
		</p>
		<div class="wc-fabric-swatches-terms-grid">
			<?php foreach ( $attr_terms as $term ) : ?>
				<label class="wc-fabric-term-option">
					<input type="checkbox"
						name="fabric_swatch_groups[<?php echo esc_attr( $gi ); ?>][term_slugs][]"
						value="<?php echo esc_attr( $term['slug'] ); ?>"
						<?php checked( in_array( $term['slug'], (array) $selected_slugs, true ) ); ?>>
					<span class="wc-fabric-term-preview">
						<?php if ( ! empty( $term['imageUrl'] ) ) : ?>
							<img src="<?php echo esc_url( $term['imageUrl'] ); ?>" alt="<?php echo esc_attr( $term['name'] ); ?>">
						<?php elseif ( ! empty( $term['color'] ) ) : ?>
							<span class="wc-fabric-term-color" style="background:<?php echo esc_attr( $term['color'] ); ?>"></span>
						<?php else : ?>
							<span class="wc-fabric-term-placeholder"></span>
						<?php endif; ?>
					</span>
					<span class="wc-fabric-term-name"><?php echo esc_html( $term['name'] ); ?></span>
				</label>
			<?php endforeach; ?>
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

		$attribute = sanitize_key( wp_unslash( $_POST['fabric_swatch_attribute'] ?? '' ) );
		update_post_meta( $post_id, '_fabric_swatch_attribute', $attribute );

		$groups = [];
		$raw    = isset( $_POST['fabric_swatch_groups'] ) ? wp_unslash( $_POST['fabric_swatch_groups'] ) : []; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

		if ( is_array( $raw ) ) {
			foreach ( $raw as $group_data ) {
				$groups[] = [
					'title'       => sanitize_text_field( $group_data['title'] ?? '' ),
					'description' => sanitize_textarea_field( $group_data['description'] ?? '' ),
					'price_label' => sanitize_text_field( $group_data['price_label'] ?? '' ),
					'term_slugs'  => array_values( array_map( 'sanitize_key', (array) ( $group_data['term_slugs'] ?? [] ) ) ),
				];
			}
		}

		update_post_meta( $post_id, '_fabric_swatch_groups', $groups );
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	/**
	 * Returns all taxonomy attributes on a product, with their terms and
	 * the swatch image/colour from CartFlows / WC term meta.
	 */
	private function get_attribute_data( $product ) {
		if ( ! $product ) {
			return [];
		}

		$result = [];

		foreach ( $product->get_attributes() as $attr_key => $attr ) {
			if ( ! $attr->is_taxonomy() ) {
				continue;
			}

			$taxonomy = $attr->get_taxonomy();
			$terms    = wc_get_product_terms( $product->get_id(), $taxonomy, [ 'fields' => 'all' ] );

			$term_data = [];
			foreach ( $terms as $term ) {
				// CartFlows / Variation Swatches stores the swatch image ID in 'product_attribute_image'
				// and colour hex in 'product_attribute_color'
				$image_id = (int) get_term_meta( $term->term_id, 'product_attribute_image', true );
				$color    = get_term_meta( $term->term_id, 'product_attribute_color', true );

				$term_data[] = [
					'slug'     => $term->slug,
					'name'     => $term->name,
					'imageUrl' => $image_id ? wp_get_attachment_image_url( $image_id, 'thumbnail' ) : '',
					'color'    => $color ?: '',
				];
			}

			$result[ $taxonomy ] = [
				'label' => wc_attribute_label( $taxonomy ),
				'terms' => $term_data,
			];
		}

		return $result;
	}
}

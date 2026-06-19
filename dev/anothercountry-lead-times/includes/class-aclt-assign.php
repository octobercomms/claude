<?php
/**
 * Assigning products to a supplier.
 *
 * Enforces the "one supplier per product" rule and provides quick ways to
 * attach products in bulk, right inside the WooCommerce Products list:
 *
 *   - A single-select supplier box on the product editor.
 *   - A "Supplier" control in the Products → Bulk Edit panel (select many
 *     products, set them all to one supplier in a single action).
 *   - A "Filter by supplier" dropdown above the Products list, so you can pull
 *     up an unattached/specific set and bulk-assign them.
 *
 * The supplier name also shows as a column on the Products list, so attachment
 * is visible at a glance.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Assign {

	public function __construct() {
		add_action( 'save_post_product', [ $this, 'save' ], 10, 1 );
		add_action( 'restrict_manage_posts', [ $this, 'filter_dropdown' ] );
		add_action( 'parse_query', [ $this, 'filter_query' ] );
		add_action( 'bulk_edit_custom_box', [ $this, 'bulk_edit_box' ], 10, 2 );
	}

	/**
	 * Single-select supplier box on the product editor.
	 * Registered as the taxonomy's `meta_box_cb`, so it replaces the default
	 * multi-select tag box and guarantees one supplier per product.
	 */
	public static function meta_box( WP_Post $post ): void {
		$terms   = self::supplier_terms();
		$current = wp_get_object_terms( $post->ID, ACLT_TAX, [ 'fields' => 'ids' ] );
		$cur     = ( ! is_wp_error( $current ) && $current ) ? (int) $current[0] : 0;

		wp_nonce_field( 'aclt_assign', 'aclt_assign_nonce' );

		echo '<select name="aclt_supplier" style="width:100%">';
		echo '<option value="0">' . esc_html__( '— None —', 'anothercountry-lead-times' ) . '</option>';
		foreach ( $terms as $t ) {
			printf(
				'<option value="%d" %s>%s</option>',
				esc_attr( $t->term_id ),
				selected( $cur, $t->term_id, false ),
				esc_html( $t->name )
			);
		}
		echo '</select>';
		echo '<p class="description" style="margin-top:6px">' .
			esc_html__( 'One supplier per product. This sets the lead time shown on the product.', 'anothercountry-lead-times' ) .
			'</p>';
	}

	/**
	 * "Supplier" control inside the Products Bulk Edit panel.
	 * `bulk_edit_custom_box` fires once per custom column; we render only for the
	 * supplier column.
	 */
	public function bulk_edit_box( string $column_name, string $post_type ): void {
		if ( 'product' !== $post_type || 'taxonomy-' . ACLT_TAX !== $column_name ) {
			return;
		}
		$terms = self::supplier_terms();
		?>
		<fieldset class="inline-edit-col-right">
			<div class="inline-edit-col">
				<label class="inline-edit-group">
					<span class="title"><?php esc_html_e( 'Supplier', 'anothercountry-lead-times' ); ?></span>
					<select name="aclt_bulk_supplier">
						<option value="-1"><?php esc_html_e( '— No change —', 'anothercountry-lead-times' ); ?></option>
						<option value="0"><?php esc_html_e( '— Remove supplier —', 'anothercountry-lead-times' ); ?></option>
						<?php foreach ( $terms as $t ) : ?>
							<option value="<?php echo esc_attr( $t->term_id ); ?>"><?php echo esc_html( $t->name ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>
			</div>
		</fieldset>
		<?php
	}

	/**
	 * "Filter by supplier" dropdown above the Products list.
	 */
	public function filter_dropdown(): void {
		if ( 'product' !== ( $GLOBALS['typenow'] ?? '' ) ) {
			return;
		}
		$current = isset( $_GET['ac_supplier_filter'] ) ? absint( $_GET['ac_supplier_filter'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$terms   = self::supplier_terms();
		echo '<select name="ac_supplier_filter">';
		echo '<option value="0">' . esc_html__( 'All suppliers', 'anothercountry-lead-times' ) . '</option>';
		foreach ( $terms as $t ) {
			printf(
				'<option value="%d" %s>%s (%d)</option>',
				esc_attr( $t->term_id ),
				selected( $current, $t->term_id, false ),
				esc_html( $t->name ),
				(int) $t->count
			);
		}
		echo '</select>';
	}

	/**
	 * Apply the supplier filter to the Products list query.
	 */
	public function filter_query( WP_Query $query ): void {
		if ( ! is_admin() || 'edit.php' !== ( $GLOBALS['pagenow'] ?? '' ) || ! $query->is_main_query() ) {
			return;
		}
		if ( 'product' !== $query->get( 'post_type' ) ) {
			return;
		}
		$tid = isset( $_GET['ac_supplier_filter'] ) ? absint( $_GET['ac_supplier_filter'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( $tid <= 0 ) {
			return;
		}
		$tax_query   = (array) $query->get( 'tax_query' );
		$tax_query[] = [
			'taxonomy' => ACLT_TAX,
			'field'    => 'term_id',
			'terms'    => [ $tid ],
		];
		$query->set( 'tax_query', $tax_query );
	}

	/**
	 * Persist supplier assignment from the editor and from bulk edit, always as a
	 * single supplier.
	 */
	public function save( int $post_id ): void {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		// Product editor (single-select box).
		if ( isset( $_POST['aclt_assign_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['aclt_assign_nonce'] ) ), 'aclt_assign' ) ) {
			if ( current_user_can( 'edit_post', $post_id ) ) {
				$tid = absint( $_POST['aclt_supplier'] ?? 0 );
				wp_set_object_terms( $post_id, $tid ? [ $tid ] : [], ACLT_TAX, false );
			}
			return;
		}

		// Bulk edit. WordPress has already verified the bulk-edit nonce before
		// looping over posts; we add a per-post capability check.
		if ( isset( $_REQUEST['bulk_edit'], $_REQUEST['aclt_bulk_supplier'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$val = sanitize_text_field( wp_unslash( $_REQUEST['aclt_bulk_supplier'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( '-1' === $val ) {
				return; // No change.
			}
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return;
			}
			$tid = absint( $val );
			wp_set_object_terms( $post_id, $tid ? [ $tid ] : [], ACLT_TAX, false );
		}
	}

	/**
	 * All supplier terms, name-ordered.
	 *
	 * @return WP_Term[]
	 */
	private static function supplier_terms(): array {
		$terms = get_terms( [
			'taxonomy'   => ACLT_TAX,
			'hide_empty' => false,
			'orderby'    => 'name',
		] );
		return is_wp_error( $terms ) ? [] : $terms;
	}
}

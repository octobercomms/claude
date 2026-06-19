<?php
/**
 * Supplier / workshop taxonomy and its lead-time term meta.
 *
 * Products are attached to a supplier once (via the standard product editor or
 * the central Lead Times screen). The lead-time data lives on the supplier term,
 * so updating one supplier updates every product attached to it.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Taxonomy {

	public function __construct() {
		add_action( 'init', [ __CLASS__, 'register_taxonomy' ] );

		// Term meta fields on the Add / Edit supplier screens.
		add_action( ACLT_TAX . '_add_form_fields', [ $this, 'add_form_fields' ] );
		add_action( ACLT_TAX . '_edit_form_fields', [ $this, 'edit_form_fields' ], 10, 2 );
		add_action( 'created_' . ACLT_TAX, [ $this, 'save_fields' ] );
		add_action( 'edited_' . ACLT_TAX, [ $this, 'save_fields' ] );
	}

	/**
	 * Register the `ac_supplier` taxonomy against products.
	 */
	public static function register_taxonomy(): void {
		$labels = [
			'name'              => __( 'Suppliers', 'anothercountry-lead-times' ),
			'singular_name'     => __( 'Supplier', 'anothercountry-lead-times' ),
			'menu_name'         => __( 'Suppliers', 'anothercountry-lead-times' ),
			'all_items'         => __( 'All Suppliers', 'anothercountry-lead-times' ),
			'edit_item'         => __( 'Edit Supplier', 'anothercountry-lead-times' ),
			'view_item'         => __( 'View Supplier', 'anothercountry-lead-times' ),
			'update_item'       => __( 'Update Supplier', 'anothercountry-lead-times' ),
			'add_new_item'      => __( 'Add New Supplier', 'anothercountry-lead-times' ),
			'new_item_name'     => __( 'New Supplier Name', 'anothercountry-lead-times' ),
			'search_items'      => __( 'Search Suppliers', 'anothercountry-lead-times' ),
			'not_found'         => __( 'No suppliers found.', 'anothercountry-lead-times' ),
			'back_to_items'     => __( '&larr; Back to Suppliers', 'anothercountry-lead-times' ),
		];

		register_taxonomy( ACLT_TAX, [ 'product' ], [
			'labels'            => $labels,
			'public'            => false,
			'publicly_queryable'=> false,
			'hierarchical'      => false,
			'show_ui'           => true,
			'show_admin_column' => true,
			'show_in_menu'      => true,
			'show_in_rest'      => true,
			'query_var'         => false,
			'rewrite'           => false,
			// Single-select box on the product editor (one supplier per product).
			'meta_box_cb'       => [ 'ACLT_Assign', 'meta_box' ],
		] );
	}

	/**
	 * The lead-time meta keys stored against each supplier term.
	 */
	public static function meta_keys(): array {
		return [
			'enabled',
			'base',
			'oos',
			'note',
			'season_enabled',
			'season_start',
			'season_end',
			'season_note',
		];
	}

	/**
	 * Read all lead-time meta for a supplier term as a tidy array.
	 */
	public static function get_data( int $term_id ): array {
		$data = [];
		foreach ( self::meta_keys() as $key ) {
			$data[ $key ] = get_term_meta( $term_id, 'aclt_' . $key, true );
		}
		$data['enabled']        = $data['enabled'] !== '' ? (int) $data['enabled'] : 1;
		$data['season_enabled'] = (int) $data['season_enabled'];
		return $data;
	}

	// -------------------------------------------------------------------------
	// Add / edit term screens
	// -------------------------------------------------------------------------

	public function add_form_fields(): void {
		wp_nonce_field( 'aclt_term', 'aclt_term_nonce' );
		?>
		<div class="form-field">
			<label for="aclt_base"><?php esc_html_e( 'Base lead time', 'anothercountry-lead-times' ); ?></label>
			<input type="text" name="aclt_base" id="aclt_base" value="" placeholder="e.g. 9&ndash;12 weeks" />
			<p><?php esc_html_e( 'Shown on every product attached to this supplier.', 'anothercountry-lead-times' ); ?></p>
		</div>
		<div class="form-field">
			<label for="aclt_oos"><?php esc_html_e( 'Out-of-stock lead time', 'anothercountry-lead-times' ); ?></label>
			<input type="text" name="aclt_oos" id="aclt_oos" value="" placeholder="e.g. 12&ndash;15 weeks" />
			<p><?php esc_html_e( 'Optional. Used when the product is out of stock / on backorder.', 'anothercountry-lead-times' ); ?></p>
		</div>
		<div class="form-field">
			<label for="aclt_note"><?php esc_html_e( 'Extra note', 'anothercountry-lead-times' ); ?></label>
			<input type="text" name="aclt_note" id="aclt_note" value="" placeholder="e.g. from receipt of fabric at the warehouse" />
		</div>
		<?php
	}

	public function edit_form_fields( WP_Term $term ): void {
		$d = self::get_data( $term->term_id );
		wp_nonce_field( 'aclt_term', 'aclt_term_nonce' );
		echo '<input type="hidden" name="aclt_full_form" value="1" />';
		?>
		<tr class="form-field">
			<th scope="row"><label for="aclt_enabled"><?php esc_html_e( 'Show lead-time notice', 'anothercountry-lead-times' ); ?></label></th>
			<td><input type="checkbox" name="aclt_enabled" id="aclt_enabled" value="1" <?php checked( $d['enabled'], 1 ); ?> /></td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="aclt_base"><?php esc_html_e( 'Base lead time', 'anothercountry-lead-times' ); ?></label></th>
			<td>
				<input type="text" name="aclt_base" id="aclt_base" value="<?php echo esc_attr( $d['base'] ); ?>" placeholder="e.g. 9&ndash;12 weeks" />
				<p class="description"><?php esc_html_e( 'Shown on every product attached to this supplier.', 'anothercountry-lead-times' ); ?></p>
			</td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="aclt_oos"><?php esc_html_e( 'Out-of-stock lead time', 'anothercountry-lead-times' ); ?></label></th>
			<td>
				<input type="text" name="aclt_oos" id="aclt_oos" value="<?php echo esc_attr( $d['oos'] ); ?>" placeholder="e.g. 12&ndash;15 weeks" />
				<p class="description"><?php esc_html_e( 'Optional. Used when the product is out of stock / on backorder.', 'anothercountry-lead-times' ); ?></p>
			</td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="aclt_note"><?php esc_html_e( 'Extra note', 'anothercountry-lead-times' ); ?></label></th>
			<td><input type="text" name="aclt_note" id="aclt_note" value="<?php echo esc_attr( $d['note'] ); ?>" placeholder="e.g. from receipt of fabric at the warehouse" /></td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="aclt_season_enabled"><?php esc_html_e( 'Seasonal lead time', 'anothercountry-lead-times' ); ?></label></th>
			<td>
				<label><input type="checkbox" name="aclt_season_enabled" id="aclt_season_enabled" value="1" <?php checked( $d['season_enabled'], 1 ); ?> /> <?php esc_html_e( 'Apply an extended lead time during a recurring date window (e.g. summer shutdown).', 'anothercountry-lead-times' ); ?></label>
			</td>
		</tr>
		<tr class="form-field">
			<th scope="row"><?php esc_html_e( 'Seasonal window', 'anothercountry-lead-times' ); ?></th>
			<td>
				<?php esc_html_e( 'From', 'anothercountry-lead-times' ); ?>
				<input type="text" name="aclt_season_start" value="<?php echo esc_attr( $d['season_start'] ); ?>" placeholder="MM-DD (e.g. 07-01)" size="10" />
				<?php esc_html_e( 'to', 'anothercountry-lead-times' ); ?>
				<input type="text" name="aclt_season_end" value="<?php echo esc_attr( $d['season_end'] ); ?>" placeholder="MM-DD (e.g. 09-30)" size="10" />
				<p class="description"><?php esc_html_e( 'Repeats every year. Windows may wrap across new year (e.g. 11-01 to 02-28).', 'anothercountry-lead-times' ); ?></p>
			</td>
		</tr>
		<tr class="form-field">
			<th scope="row"><label for="aclt_season_note"><?php esc_html_e( 'Seasonal note', 'anothercountry-lead-times' ); ?></label></th>
			<td>
				<input type="text" name="aclt_season_note" id="aclt_season_note" value="<?php echo esc_attr( $d['season_note'] ); ?>" placeholder="e.g. Allow an extra 3&ndash;4 weeks for summer shutdown" />
				<p class="description"><?php esc_html_e( 'Shown below the lead time while the seasonal window is active.', 'anothercountry-lead-times' ); ?></p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Persist the term meta from either the add or edit screen.
	 */
	public function save_fields( int $term_id ): void {
		if ( ! isset( $_POST['aclt_term_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['aclt_term_nonce'] ) ), 'aclt_term' ) ) {
			return;
		}
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		// On the "add" screen the checkboxes aren't rendered, so only update keys present.
		if ( isset( $_POST['aclt_base'] ) ) {
			update_term_meta( $term_id, 'aclt_base', sanitize_text_field( wp_unslash( $_POST['aclt_base'] ) ) );
		}
		if ( isset( $_POST['aclt_oos'] ) ) {
			update_term_meta( $term_id, 'aclt_oos', sanitize_text_field( wp_unslash( $_POST['aclt_oos'] ) ) );
		}
		if ( isset( $_POST['aclt_note'] ) ) {
			update_term_meta( $term_id, 'aclt_note', sanitize_text_field( wp_unslash( $_POST['aclt_note'] ) ) );
		}
		if ( isset( $_POST['aclt_season_note'] ) ) {
			update_term_meta( $term_id, 'aclt_season_note', sanitize_text_field( wp_unslash( $_POST['aclt_season_note'] ) ) );
		}
		if ( isset( $_POST['aclt_season_start'] ) ) {
			update_term_meta( $term_id, 'aclt_season_start', ACLT_Resolver::sanitize_md( wp_unslash( $_POST['aclt_season_start'] ) ) );
		}
		if ( isset( $_POST['aclt_season_end'] ) ) {
			update_term_meta( $term_id, 'aclt_season_end', ACLT_Resolver::sanitize_md( wp_unslash( $_POST['aclt_season_end'] ) ) );
		}

		// Checkboxes only render on the edit screen, so only persist their
		// (un)checked state when the full edit form was submitted. On the add
		// screen `enabled` defaults to 1 and `season_enabled` to 0.
		if ( isset( $_POST['aclt_full_form'] ) ) {
			update_term_meta( $term_id, 'aclt_enabled', isset( $_POST['aclt_enabled'] ) ? 1 : 0 );
			update_term_meta( $term_id, 'aclt_season_enabled', isset( $_POST['aclt_season_enabled'] ) ? 1 : 0 );
		}
	}
}

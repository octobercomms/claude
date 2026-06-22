<?php
/**
 * Plugin Name: OctoberComms Bulk Editor for WooCommerce
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Spreadsheet-style bulk editor for WooCommerce products and variants. Edit prices, stock, SKUs, images and Variant Showcase settings (catalogue display + lifestyle image), merge several products into one variable product, and export/import via CSV.
 * Version:     1.3.0
 * Author:      OctoberComms
 * Text Domain: oct-bulk-editor
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

define( 'OCTWBE_VERSION', '1.3.0' );

/*
 * Variant Showcase meta keys (kept as literals so this editor stays decoupled
 * from the Variant Showcase plugin — either can be active alone, and when both
 * are installed they share the same per-product/variation meta).
 */
define( 'OCTWBE_ACVS_MODE', '_acvs_mode' );               // product: default|expand|single
define( 'OCTWBE_ACVS_SHOW', '_acvs_show_in_catalog' );    // variation: 'yes' to expose as its own card
define( 'OCTWBE_ACVS_LIFESTYLE', '_acvs_lifestyle_image_id' ); // product/variation: hover image attachment ID
define( 'OCTWBE_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OCTWBE_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

class OctBulkEditor {

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
		add_action( 'wp_ajax_octwbe_get_products', [ $this, 'ajax_get_products' ] );
		add_action( 'wp_ajax_octwbe_save_changes', [ $this, 'ajax_save_changes' ] );
		add_action( 'wp_ajax_octwbe_upload_image', [ $this, 'ajax_upload_image' ] );
		add_action( 'wp_ajax_octwbe_import', [ $this, 'ajax_import' ] );
		add_action( 'admin_post_octwbe_export', [ $this, 'handle_export' ] );
	}

	public function register_menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Bulk Editor', 'oct-bulk-editor' ),
			__( 'Bulk Editor', 'oct-bulk-editor' ),
			'manage_woocommerce',
			'oct-bulk-editor',
			[ $this, 'render_page' ]
		);
	}

	public function enqueue_assets( string $hook ): void {
		if ( $hook !== 'woocommerce_page_oct-bulk-editor' ) {
			return;
		}

		wp_enqueue_media();

		wp_enqueue_style(
			'wbe-styles',
			OCTWBE_PLUGIN_URL . 'assets/css/bulk-editor.css',
			[],
			OCTWBE_VERSION
		);

		wp_enqueue_script(
			'wbe-script',
			OCTWBE_PLUGIN_URL . 'assets/js/bulk-editor.js',
			[ 'jquery' ],
			OCTWBE_VERSION,
			true
		);

		wp_localize_script( 'wbe-script', 'octwbe', [
			'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
			'exportUrl'    => admin_url( 'admin-post.php' ),
			'nonce'        => wp_create_nonce( 'octwbe_nonce' ),
			'uploadNonce'  => wp_create_nonce( 'octwbe_upload_image' ),
			'exportNonce'  => wp_create_nonce( 'octwbe_export' ),
			'importNonce'  => wp_create_nonce( 'octwbe_import' ),
			'i18n'         => [
				'saving'        => __( 'Saving…', 'oct-bulk-editor' ),
				'saved'         => __( 'All changes saved!', 'oct-bulk-editor' ),
				'saveError'     => __( 'Save failed. Please try again.', 'oct-bulk-editor' ),
				'noChanges'     => __( 'No changes to save.', 'oct-bulk-editor' ),
				'confirmDiscard'=> __( 'Discard all unsaved changes?', 'oct-bulk-editor' ),
				'loading'       => __( 'Loading products…', 'oct-bulk-editor' ),
				'selectImage'   => __( 'Select image', 'oct-bulk-editor' ),
				'useImage'      => __( 'Use this image', 'oct-bulk-editor' ),
				'uploading'     => __( 'Uploading…', 'oct-bulk-editor' ),
				'uploadError'   => __( 'Upload failed.', 'oct-bulk-editor' ),
			],
		] );
	}

	public function render_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'oct-bulk-editor' ) );
		}
		include OCTWBE_PLUGIN_DIR . 'includes/admin-page.php';
	}

	// -------------------------------------------------------------------------
	// AJAX: Fetch products
	// -------------------------------------------------------------------------

	public function ajax_get_products(): void {
		check_ajax_referer( 'octwbe_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}

		$search   = sanitize_text_field( $_POST['search'] ?? '' );
		$category = absint( $_POST['category'] ?? 0 );
		$page     = max( 1, absint( $_POST['page'] ?? 1 ) );
		$per_page = 50;

		$args = [
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'title',
			'order'          => 'ASC',
		];

		if ( $search !== '' ) {
			$args['s'] = $search;
		}

		if ( $category > 0 ) {
			$args['tax_query'] = [ [
				'taxonomy' => 'product_cat',
				'field'    => 'term_id',
				'terms'    => $category,
			] ];
		}

		$query = new WP_Query( $args );
		$rows  = [];

		foreach ( $query->posts as $post ) {
			$product = wc_get_product( $post->ID );
			if ( ! $product ) {
				continue;
			}

			if ( $product->is_type( 'variable' ) ) {
				// Parent row (read-only header)
				$rows[] = $this->format_parent_row( $product );

				// One row per variation
				foreach ( $product->get_children() as $variation_id ) {
					$variation = wc_get_product( $variation_id );
					if ( $variation ) {
						$rows[] = $this->format_variation_row( $variation, $product );
					}
				}
			} else {
				$rows[] = $this->format_simple_row( $product );
			}
		}

		wp_send_json_success( [
			'rows'        => $rows,
			'total_pages' => $query->max_num_pages,
			'total'       => $query->found_posts,
			'page'        => $page,
		] );
	}

	private function get_image_data( int $attachment_id ): array {
		if ( ! $attachment_id ) {
			return [ 'image_id' => '', 'image_thumb' => '' ];
		}
		$thumb = wp_get_attachment_image_url( $attachment_id, [ 50, 50 ] );
		return [
			'image_id'    => $attachment_id,
			'image_thumb' => $thumb ?: '',
		];
	}

	/**
	 * Variant Showcase fields for a product or variation row: catalogue mode,
	 * the "show as its own card" flag, and the lifestyle (hover) image.
	 */
	private function get_acvs_data( WC_Product $p ): array {
		$lifestyle_id = (int) $p->get_meta( OCTWBE_ACVS_LIFESTYLE );
		$thumb        = $lifestyle_id ? wp_get_attachment_image_url( $lifestyle_id, [ 50, 50 ] ) : '';

		return [
			'acvs_mode'       => $p->get_meta( OCTWBE_ACVS_MODE ) ?: 'default',
			'acvs_show'       => $p->get_meta( OCTWBE_ACVS_SHOW ) === 'yes' ? 'yes' : 'no',
			'lifestyle_id'    => $lifestyle_id ?: '',
			'lifestyle_thumb' => $thumb ?: '',
		];
	}

	private function format_parent_row( WC_Product $p ): array {
		return array_merge( [
			'id'           => $p->get_id(),
			'type'         => 'parent',
			'name'         => $p->get_name(),
			'sku'          => $p->get_sku(),
			'regular_price'=> '',
			'sale_price'   => '',
			'stock_qty'    => '',
			'stock_status' => '',
			'status'       => $p->get_status(),
			'image_id'     => '',
			'image_thumb'  => '',
			'edit_url'     => get_edit_post_link( $p->get_id(), '' ),
		], $this->get_acvs_data( $p ) );
	}

	private function format_simple_row( WC_Product $p ): array {
		return array_merge( [
			'id'           => $p->get_id(),
			'type'         => 'simple',
			'name'         => $p->get_name(),
			'sku'          => $p->get_sku(),
			'regular_price'=> $p->get_regular_price(),
			'sale_price'   => $p->get_sale_price(),
			'stock_qty'    => $p->get_manage_stock() ? $p->get_stock_quantity() : '',
			'stock_status' => $p->get_stock_status(),
			'status'       => $p->get_status(),
			'edit_url'     => get_edit_post_link( $p->get_id(), '' ),
		], $this->get_image_data( (int) $p->get_image_id() ), $this->get_acvs_data( $p ) );
	}

	private function format_variation_row( WC_Product_Variation $v, WC_Product $parent ): array {
		$attrs = [];
		foreach ( $v->get_variation_attributes() as $key => $val ) {
			$tax    = str_replace( 'attribute_', '', $key );
			$label  = wc_attribute_label( $tax );
			$attrs[] = $label . ': ' . ( $val ?: __( 'Any', 'oct-bulk-editor' ) );
		}

		// Variation image falls back to parent image if not set
		$image_id = (int) $v->get_image_id();
		if ( ! $image_id ) {
			$image_id = (int) $parent->get_image_id();
		}

		return array_merge( [
			'id'            => $v->get_id(),
			'parent_id'     => $parent->get_id(),
			'type'          => 'variation',
			'name'          => implode( ' / ', $attrs ) ?: '#' . $v->get_id(),
			'sku'           => $v->get_sku(),
			'regular_price' => $v->get_regular_price(),
			'sale_price'    => $v->get_sale_price(),
			'stock_qty'     => $v->get_manage_stock() ? $v->get_stock_quantity() : '',
			'stock_status'  => $v->get_stock_status(),
			'status'        => $v->get_status(),
			'edit_url'      => get_edit_post_link( $parent->get_id(), '' ),
		], $this->get_image_data( $image_id ), $this->get_acvs_data( $v ) );
	}

	// -------------------------------------------------------------------------
	// AJAX: Save changes
	// -------------------------------------------------------------------------

	public function ajax_save_changes(): void {
		check_ajax_referer( 'octwbe_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}

		$changes = json_decode( stripslashes( $_POST['changes'] ?? '[]' ), true );

		if ( ! is_array( $changes ) || empty( $changes ) ) {
			wp_send_json_error( 'No changes provided.' );
		}

		$saved  = [];
		$errors = [];

		foreach ( $changes as $change ) {
			$id    = absint( $change['id'] ?? 0 );
			$field = sanitize_key( $change['field'] ?? '' );
			$value = sanitize_text_field( $change['value'] ?? '' );

			if ( ! $id || ! $field ) {
				continue;
			}

			$product = wc_get_product( $id );
			if ( ! $product ) {
				$errors[] = "Product {$id} not found.";
				continue;
			}

			$allowed_fields = [ 'regular_price', 'sale_price', 'sku', 'stock_qty', 'stock_status', 'status', 'image', 'acvs_mode', 'acvs_show', 'acvs_lifestyle' ];
			if ( ! in_array( $field, $allowed_fields, true ) ) {
				$errors[] = "Field '{$field}' is not editable.";
				continue;
			}

			$result = $this->apply_field( $product, $field, $value );

			if ( is_wp_error( $result ) ) {
				$errors[] = $result->get_error_message();
			} else {
				$saved[] = $id;
			}
		}

		if ( ! empty( $errors ) ) {
			wp_send_json_error( [ 'errors' => $errors, 'saved' => $saved ] );
		}

		wp_send_json_success( [ 'saved' => array_unique( $saved ) ] );
	}

	private function apply_field( WC_Product $product, string $field, string $value ): bool|WP_Error {
		$result = $this->set_field_value( $product, $field, $value );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$product->save();
		return true;
	}

	/** Set a single field on the product object without saving (caller saves). */
	private function set_field_value( WC_Product $product, string $field, string $value ): bool|WP_Error {
		switch ( $field ) {
			case 'regular_price':
				if ( $value !== '' && ! is_numeric( $value ) ) {
					return new WP_Error( 'invalid', "Invalid regular price for product {$product->get_id()}." );
				}
				$product->set_regular_price( $value );
				break;

			case 'sale_price':
				if ( $value !== '' && ! is_numeric( $value ) ) {
					return new WP_Error( 'invalid', "Invalid sale price for product {$product->get_id()}." );
				}
				$product->set_sale_price( $value );
				break;

			case 'sku':
				try {
					$product->set_sku( $value );
				} catch ( WC_Data_Exception $e ) {
					return new WP_Error( 'sku', $e->getMessage() );
				}
				break;

			case 'stock_qty':
				if ( $value !== '' ) {
					if ( ! is_numeric( $value ) ) {
						return new WP_Error( 'invalid', "Invalid stock qty for product {$product->get_id()}." );
					}
					$product->set_manage_stock( true );
					$product->set_stock_quantity( (float) $value );
				} else {
					$product->set_manage_stock( false );
				}
				break;

			case 'stock_status':
				$allowed = [ 'instock', 'outofstock', 'onbackorder' ];
				if ( ! in_array( $value, $allowed, true ) ) {
					return new WP_Error( 'invalid', "Invalid stock status '{$value}'." );
				}
				$product->set_stock_status( $value );
				break;

			case 'status':
				$allowed = [ 'publish', 'draft', 'private', 'pending' ];
				if ( ! in_array( $value, $allowed, true ) ) {
					return new WP_Error( 'invalid', "Invalid status '{$value}'." );
				}
				$product->set_status( $value );
				break;

			case 'image':
				$attachment_id = absint( $value );
				if ( $value !== '' && ( ! $attachment_id || get_post_type( $attachment_id ) !== 'attachment' ) ) {
					return new WP_Error( 'invalid', "Invalid image attachment ID for product {$product->get_id()}." );
				}
				$product->set_image_id( $attachment_id ?: '' );
				break;

			case 'acvs_mode':
				$allowed = [ 'default', 'expand', 'single' ];
				if ( ! in_array( $value, $allowed, true ) ) {
					return new WP_Error( 'invalid', "Invalid catalogue mode '{$value}'." );
				}
				$product->update_meta_data( OCTWBE_ACVS_MODE, $value );
				break;

			case 'acvs_show':
				$show = $value === 'yes' ? 'yes' : 'no';
				$product->update_meta_data( OCTWBE_ACVS_SHOW, $show );

				// Convenience: ticking a variation only does something on the
				// storefront when its parent is in "expand" mode, so switch the
				// parent over automatically the first time one is ticked.
				if ( $show === 'yes' && $product->is_type( 'variation' ) ) {
					$parent = wc_get_product( $product->get_parent_id() );
					if ( $parent && $parent->get_meta( OCTWBE_ACVS_MODE ) !== 'expand' ) {
						$parent->update_meta_data( OCTWBE_ACVS_MODE, 'expand' );
						$parent->save();
					}
				}
				break;

			case 'acvs_lifestyle':
				$attachment_id = absint( $value );
				if ( $value !== '' && ( ! $attachment_id || get_post_type( $attachment_id ) !== 'attachment' ) ) {
					return new WP_Error( 'invalid', "Invalid lifestyle image ID for product {$product->get_id()}." );
				}
				$product->update_meta_data( OCTWBE_ACVS_LIFESTYLE, $attachment_id ?: '' );
				break;
		}

		return true;
	}

	// -------------------------------------------------------------------------
	// AJAX: Upload image from drag-and-drop
	// -------------------------------------------------------------------------

	public function ajax_upload_image(): void {
		check_ajax_referer( 'octwbe_upload_image', 'nonce' );

		if ( ! current_user_can( 'upload_files' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}

		if ( empty( $_FILES['file'] ) ) {
			wp_send_json_error( 'No file received.' );
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$attachment_id = media_handle_upload( 'file', 0 );

		if ( is_wp_error( $attachment_id ) ) {
			wp_send_json_error( $attachment_id->get_error_message() );
		}

		$thumb = wp_get_attachment_image_url( $attachment_id, [ 50, 50 ] );

		wp_send_json_success( [
			'attachment_id' => $attachment_id,
			'thumb_url'     => $thumb ?: '',
		] );
	}

	// -------------------------------------------------------------------------
	// Export: download the current filter as CSV
	// -------------------------------------------------------------------------

	public function handle_export(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to export.', 'oct-bulk-editor' ) );
		}
		check_admin_referer( 'octwbe_export' );

		$search   = sanitize_text_field( wp_unslash( $_GET['search'] ?? '' ) );
		$category = absint( $_GET['category'] ?? 0 );

		$args = [
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'orderby'        => 'title',
			'order'          => 'ASC',
			'no_found_rows'  => true,
		];
		if ( $search !== '' ) {
			$args['s'] = $search;
		}
		if ( $category > 0 ) {
			$args['tax_query'] = [ [
				'taxonomy' => 'product_cat',
				'field'    => 'term_id',
				'terms'    => $category,
			] ];
		}

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="products-' . gmdate( 'Ymd-His' ) . '.csv"' );

		$out = fopen( 'php://output', 'w' );
		fputcsv( $out, [ 'id', 'type', 'parent_id', 'product', 'variation', 'sku', 'regular_price', 'sale_price', 'stock_qty', 'stock_status', 'status', 'on_category', 'lifestyle_image_id' ] );

		foreach ( ( new WP_Query( $args ) )->posts as $post ) {
			$product = wc_get_product( $post->ID );
			if ( ! $product ) {
				continue;
			}
			if ( $product->is_type( 'variable' ) ) {
				foreach ( $product->get_children() as $vid ) {
					$variation = wc_get_product( $vid );
					if ( $variation ) {
						$this->export_row( $out, $variation, $product );
					}
				}
			} else {
				$this->export_row( $out, $product, null );
			}
		}

		fclose( $out );
		exit;
	}

	private function export_row( $out, WC_Product $p, ?WC_Product $parent ): void {
		$is_variation    = $p->is_type( 'variation' );
		$variation_label = '';
		if ( $is_variation ) {
			$bits = [];
			foreach ( $p->get_variation_attributes() as $key => $val ) {
				$tax    = str_replace( 'attribute_', '', $key );
				$bits[] = wc_attribute_label( $tax ) . ': ' . $val;
			}
			$variation_label = implode( ' / ', $bits );
		}

		fputcsv( $out, [
			$p->get_id(),
			$is_variation ? 'variation' : 'simple',
			$parent ? $parent->get_id() : '',
			$parent ? $parent->get_name() : $p->get_name(),
			$variation_label,
			$p->get_sku(),
			$p->get_regular_price(),
			$p->get_sale_price(),
			$p->get_manage_stock() ? $p->get_stock_quantity() : '',
			$p->get_stock_status(),
			$p->get_status(),
			$p->get_meta( OCTWBE_ACVS_SHOW ) === 'yes' ? 'yes' : 'no',
			(int) $p->get_meta( OCTWBE_ACVS_LIFESTYLE ) ?: '',
		] );
	}

	// -------------------------------------------------------------------------
	// Import: apply a CSV (matched by id) through the same field setters
	// -------------------------------------------------------------------------

	public function ajax_import(): void {
		check_ajax_referer( 'octwbe_import', 'nonce' );
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}
		if ( empty( $_FILES['file']['tmp_name'] ) || ! is_uploaded_file( $_FILES['file']['tmp_name'] ) ) {
			wp_send_json_error( __( 'No file received.', 'oct-bulk-editor' ) );
		}

		$handle = fopen( $_FILES['file']['tmp_name'], 'r' );
		if ( ! $handle ) {
			wp_send_json_error( __( 'Could not read the file.', 'oct-bulk-editor' ) );
		}

		$header = fgetcsv( $handle );
		if ( ! $header ) {
			fclose( $handle );
			wp_send_json_error( __( 'The file appears to be empty.', 'oct-bulk-editor' ) );
		}
		$header = array_map( static fn( $h ) => strtolower( trim( (string) $h ) ), $header );
		$idx    = array_flip( $header );
		if ( ! isset( $idx['id'] ) ) {
			fclose( $handle );
			wp_send_json_error( __( 'The CSV must include an "id" column (export first to get the right format).', 'oct-bulk-editor' ) );
		}

		// CSV column => editor field.
		$map = [
			'sku'                => 'sku',
			'regular_price'      => 'regular_price',
			'sale_price'         => 'sale_price',
			'stock_qty'          => 'stock_qty',
			'stock_status'       => 'stock_status',
			'status'             => 'status',
			'on_category'        => 'acvs_show',
			'lifestyle_image_id' => 'acvs_lifestyle',
		];

		$updated = 0;
		$errors  = [];
		$rownum  = 1;

		while ( ( $row = fgetcsv( $handle ) ) !== false ) {
			$rownum++;
			$id = absint( $row[ $idx['id'] ] ?? 0 );
			if ( ! $id ) {
				continue;
			}
			$product = wc_get_product( $id );
			if ( ! $product ) {
				$errors[] = "Row {$rownum}: product {$id} not found.";
				continue;
			}

			$dirty = false;
			foreach ( $map as $col => $field ) {
				if ( ! isset( $idx[ $col ] ) ) {
					continue;
				}
				$value  = sanitize_text_field( (string) ( $row[ $idx[ $col ] ] ?? '' ) );
				$result = $this->set_field_value( $product, $field, $value );
				if ( is_wp_error( $result ) ) {
					$errors[] = "Row {$rownum} ({$col}): " . $result->get_error_message();
				} else {
					$dirty = true;
				}
			}

			if ( $dirty ) {
				$product->save();
				$updated++;
			}
		}

		fclose( $handle );

		wp_send_json_success( [ 'updated' => $updated, 'errors' => $errors ] );
	}
}

require_once OCTWBE_PLUGIN_DIR . 'includes/class-octwbe-merge.php';

// Bootstrap
add_action( 'plugins_loaded', function () {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>' .
				esc_html__( 'WooCommerce Bulk Editor requires WooCommerce to be active.', 'oct-bulk-editor' ) .
				'</p></div>';
		} );
		return;
	}

	new OctBulkEditor();
	new OctWBE_Merge();
} );

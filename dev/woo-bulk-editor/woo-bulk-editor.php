<?php
/**
 * Plugin Name: WooCommerce Bulk Editor
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Spreadsheet-style bulk editor for WooCommerce products and variants. Edit prices, stock, SKUs and more without clicking one by one.
 * Version:     1.0.0
 * Author:      OctoberComms
 * Text Domain: woo-bulk-editor
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

define( 'WBE_VERSION', '1.0.0' );
define( 'WBE_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'WBE_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

class WooBulkEditor {

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
		add_action( 'wp_ajax_wbe_get_products', [ $this, 'ajax_get_products' ] );
		add_action( 'wp_ajax_wbe_save_changes', [ $this, 'ajax_save_changes' ] );
	}

	public function register_menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Bulk Editor', 'woo-bulk-editor' ),
			__( 'Bulk Editor', 'woo-bulk-editor' ),
			'manage_woocommerce',
			'woo-bulk-editor',
			[ $this, 'render_page' ]
		);
	}

	public function enqueue_assets( string $hook ): void {
		if ( $hook !== 'woocommerce_page_woo-bulk-editor' ) {
			return;
		}

		wp_enqueue_style(
			'wbe-styles',
			WBE_PLUGIN_URL . 'assets/css/bulk-editor.css',
			[],
			WBE_VERSION
		);

		wp_enqueue_script(
			'wbe-script',
			WBE_PLUGIN_URL . 'assets/js/bulk-editor.js',
			[ 'jquery' ],
			WBE_VERSION,
			true
		);

		wp_localize_script( 'wbe-script', 'wbe', [
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'wbe_nonce' ),
			'i18n'    => [
				'saving'        => __( 'Saving…', 'woo-bulk-editor' ),
				'saved'         => __( 'All changes saved!', 'woo-bulk-editor' ),
				'saveError'     => __( 'Save failed. Please try again.', 'woo-bulk-editor' ),
				'noChanges'     => __( 'No changes to save.', 'woo-bulk-editor' ),
				'confirmDiscard'=> __( 'Discard all unsaved changes?', 'woo-bulk-editor' ),
				'loading'       => __( 'Loading products…', 'woo-bulk-editor' ),
			],
		] );
	}

	public function render_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'woo-bulk-editor' ) );
		}
		include WBE_PLUGIN_DIR . 'includes/admin-page.php';
	}

	// -------------------------------------------------------------------------
	// AJAX: Fetch products
	// -------------------------------------------------------------------------

	public function ajax_get_products(): void {
		check_ajax_referer( 'wbe_nonce', 'nonce' );

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

	private function format_parent_row( WC_Product $p ): array {
		return [
			'id'           => $p->get_id(),
			'type'         => 'parent',
			'name'         => $p->get_name(),
			'sku'          => $p->get_sku(),
			'regular_price'=> '',
			'sale_price'   => '',
			'stock_qty'    => '',
			'stock_status' => '',
			'status'       => $p->get_status(),
			'edit_url'     => get_edit_post_link( $p->get_id(), '' ),
		];
	}

	private function format_simple_row( WC_Product $p ): array {
		return [
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
		];
	}

	private function format_variation_row( WC_Product_Variation $v, WC_Product $parent ): array {
		$attrs = [];
		foreach ( $v->get_variation_attributes() as $key => $val ) {
			$tax    = str_replace( 'attribute_', '', $key );
			$label  = wc_attribute_label( $tax );
			$attrs[] = $label . ': ' . ( $val ?: __( 'Any', 'woo-bulk-editor' ) );
		}

		return [
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
		];
	}

	// -------------------------------------------------------------------------
	// AJAX: Save changes
	// -------------------------------------------------------------------------

	public function ajax_save_changes(): void {
		check_ajax_referer( 'wbe_nonce', 'nonce' );

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

			$allowed_fields = [ 'regular_price', 'sale_price', 'sku', 'stock_qty', 'stock_status', 'status' ];
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

	private function apply_field( WC_Product $product, string $field, string $value ): true|WP_Error {
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
		}

		$product->save();

		return true;
	}
}

// Bootstrap
add_action( 'plugins_loaded', function () {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>' .
				esc_html__( 'WooCommerce Bulk Editor requires WooCommerce to be active.', 'woo-bulk-editor' ) .
				'</p></div>';
		} );
		return;
	}

	new WooBulkEditor();
} );

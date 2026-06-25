<?php
/**
 * REST API for the Google Sheets sync.
 *
 * Endpoints (namespace wbe/v1), all token-authenticated:
 *   GET  /ping     — connectivity + store settings probe
 *   GET  /products — products & variations in spreadsheet-friendly rows
 *   POST /push     — apply edits, with server-side conflict detection
 *
 * @package WooBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class WBE_REST {

	const NS = 'wbe/v1';

	public function __construct() {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		register_rest_route( self::NS, '/ping', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'ping' ],
			'permission_callback' => [ $this, 'authorize' ],
		] );

		register_rest_route( self::NS, '/products', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'get_products' ],
			'permission_callback' => [ $this, 'authorize' ],
		] );

		register_rest_route( self::NS, '/push', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'push' ],
			'permission_callback' => [ $this, 'authorize' ],
		] );
	}

	// -------------------------------------------------------------------------
	// Auth — shared token sent by the Apps Script.
	// -------------------------------------------------------------------------

	public function authorize( WP_REST_Request $req ): bool|WP_Error {
		$stored = (string) get_option( 'wbe_sync_token', '' );
		if ( $stored === '' ) {
			return new WP_Error( 'wbe_disabled', 'Sheets sync is not enabled on this store.', [ 'status' => 403 ] );
		}

		$sent = (string) $req->get_header( 'x_wbe_token' );

		if ( $sent === '' ) {
			$auth = (string) $req->get_header( 'authorization' );
			if ( $auth && stripos( $auth, 'bearer ' ) === 0 ) {
				$sent = trim( substr( $auth, 7 ) );
			}
		}

		if ( $sent === '' ) {
			$sent = (string) $req->get_param( 'token' );
		}

		if ( $sent === '' || ! hash_equals( $stored, $sent ) ) {
			return new WP_Error( 'wbe_bad_token', 'Invalid sync token.', [ 'status' => 401 ] );
		}

		return true;
	}

	// -------------------------------------------------------------------------
	// Endpoints
	// -------------------------------------------------------------------------

	public function ping(): WP_REST_Response {
		return new WP_REST_Response( [
			'ok'             => true,
			'store'          => get_bloginfo( 'name' ),
			'currency'       => get_woocommerce_currency(),
			'stock_readonly' => (bool) get_option( 'wbe_sync_stock_readonly', 1 ),
			'columns'        => WBE_Fields::sheet_fields(),
		] );
	}

	public function get_products( WP_REST_Request $req ): WP_REST_Response {
		$page     = max( 1, (int) $req->get_param( 'page' ) );
		$per_page = min( 100, max( 1, (int) ( $req->get_param( 'per_page' ) ?: 100 ) ) );
		$search   = sanitize_text_field( (string) $req->get_param( 'search' ) );
		$category = (int) $req->get_param( 'category' );

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
				// Variations are independently priced, so export one row each.
				foreach ( $product->get_children() as $variation_id ) {
					$variation = wc_get_product( $variation_id );
					if ( $variation ) {
						$rows[] = $this->row( $variation, $product );
					}
				}
			} else {
				$rows[] = $this->row( $product );
			}
		}

		return new WP_REST_Response( [
			'rows'        => $rows,
			'page'        => $page,
			'total_pages' => (int) $query->max_num_pages,
			'total'       => (int) $query->found_posts,
		] );
	}

	private function row( WC_Product $p, ?WC_Product $parent = null ): array {
		$row = [];
		foreach ( WBE_Fields::sheet_fields() as $field ) {
			$row[ $field ] = WBE_Fields::current( $p, $field );
		}

		if ( $parent ) {
			$attrs = [];
			foreach ( $p->get_variation_attributes() as $key => $val ) {
				$label   = wc_attribute_label( str_replace( 'attribute_', '', $key ) );
				$attrs[] = $label . ': ' . ( $val !== '' ? $val : 'Any' );
			}
			$suffix          = implode( ' / ', $attrs ) ?: ( '#' . $p->get_id() );
			$row['name']     = $parent->get_name() . ' — ' . $suffix;
			$row['parent_id'] = $parent->get_id();
		} else {
			$row['parent_id'] = 0;
		}

		return $row;
	}

	/**
	 * Apply edits. Each change carries the value the sheet last saw
	 * (`baseline`); if the live store value no longer matches that baseline,
	 * the field changed in WooCommerce since the last pull and we report a
	 * conflict instead of overwriting — unless `force` is set.
	 */
	public function push( WP_REST_Request $req ): WP_REST_Response {
		$force     = filter_var( $req->get_param( 'force' ), FILTER_VALIDATE_BOOLEAN );
		$changes   = $req->get_param( 'changes' );
		$stock_ro  = (bool) get_option( 'wbe_sync_stock_readonly', 1 );

		if ( ! is_array( $changes ) || ! $changes ) {
			return new WP_REST_Response( [ 'saved' => [], 'conflicts' => [], 'errors' => [ 'No changes provided.' ] ] );
		}

		$saved     = [];
		$conflicts = [];
		$errors    = [];
		$dirty     = []; // id => WC_Product, edited in place then saved once.

		foreach ( $changes as $c ) {
			$id       = (int) ( $c['id'] ?? 0 );
			$field    = sanitize_key( $c['field'] ?? '' );
			$value    = isset( $c['value'] ) ? (string) $c['value'] : '';
			$baseline = isset( $c['baseline'] ) ? (string) $c['baseline'] : '';

			if ( ! $id || $field === '' ) {
				continue;
			}

			if ( ! in_array( $field, WBE_Fields::editable_fields(), true ) ) {
				$errors[] = "Field '{$field}' is not editable.";
				continue;
			}

			if ( $field === 'stock_qty' && $stock_ro ) {
				$errors[] = "Stock is read-only on this store; skipped for product {$id}.";
				continue;
			}

			$product = $dirty[ $id ] ?? wc_get_product( $id );
			if ( ! $product ) {
				$errors[] = "Product {$id} not found.";
				continue;
			}

			$live = WBE_Fields::current( $product, $field );

			if ( ! $force && ! WBE_Fields::matches( $field, $live, $baseline ) ) {
				$conflicts[] = [
					'id'        => $id,
					'field'     => $field,
					'baseline'  => $baseline,
					'current'   => $live,
					'attempted' => $value,
				];
				continue;
			}

			$result = WBE_Fields::apply( $product, $field, $value );
			if ( is_wp_error( $result ) ) {
				$errors[] = $result->get_error_message();
				continue;
			}

			$dirty[ $id ] = $product;
		}

		foreach ( $dirty as $id => $product ) {
			$product->save();
			$saved[] = $id;
		}

		return new WP_REST_Response( [
			'saved'     => array_values( array_unique( $saved ) ),
			'conflicts' => $conflicts,
			'errors'    => $errors,
		] );
	}
}

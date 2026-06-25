<?php
/**
 * REST API for the Google Sheets sync.
 *
 * Endpoints (namespace octwbe/v1), all token-authenticated:
 *   GET  /ping     — connectivity + store settings probe
 *   GET  /products — products & variations as spreadsheet rows (CSV columns)
 *   POST /push     — apply edits, with server-side conflict detection
 *
 * Writes go through OctBulkEditor::set_field_value() so the sync saves exactly
 * like the in-app editor and CSV import.
 *
 * @package OctBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class OCTWBE_REST {

	const NS = 'octwbe/v1';

	private OctBulkEditor $editor;

	public function __construct( OctBulkEditor $editor ) {
		$this->editor = $editor;
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
		$stored = (string) get_option( 'octwbe_sync_token', '' );
		if ( $stored === '' ) {
			return new WP_Error( 'octwbe_disabled', 'Sheets sync is not enabled on this store.', [ 'status' => 403 ] );
		}

		$sent = (string) $req->get_header( 'x_octwbe_token' );

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
			return new WP_Error( 'octwbe_bad_token', 'Invalid sync token.', [ 'status' => 401 ] );
		}

		return true;
	}

	// -------------------------------------------------------------------------
	// Endpoints
	// -------------------------------------------------------------------------

	/**
	 * Mark the current response uncacheable. The sync MUST read live data, but
	 * page caches (this store runs LiteSpeed Cache) cache REST API GET responses
	 * by default — which served a stale product list straight from cache without
	 * ever running PHP, so the pull kept returning an old, short variation set.
	 * Send the standard no-cache headers and fire LiteSpeed's own no-cache signal
	 * (a no-op when LiteSpeed isn't active). The Apps Script also appends a unique
	 * cache-buster per request, so existing cache entries are bypassed too.
	 */
	private function no_cache(): void {
		nocache_headers();
		do_action( 'litespeed_control_set_nocache', 'OctoberComms Bulk Editor sync must read live data' );
	}

	public function ping(): WP_REST_Response {
		$this->no_cache();
		return new WP_REST_Response( [
			'ok'             => true,
			'store'          => get_bloginfo( 'name' ),
			'currency'       => get_woocommerce_currency(),
			'stock_readonly' => (bool) get_option( 'octwbe_sync_stock_readonly', 1 ),
			'columns'        => OCTWBE_Fields::columns(),
			'editable'       => array_keys( OCTWBE_Fields::editable_map() ),
		] );
	}

	public function get_products( WP_REST_Request $req ): WP_REST_Response {
		$this->no_cache();
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
				// Variations are independently priced; export one row each, sorted
				// alphabetically by attribute label like the grid and CSV export.
				$variation_ids = OctBulkEditor::variation_ids( $product );

				// Bulk-prime the post + meta caches for every variation up front, so
				// hydrating hundreds of them costs a couple of queries instead of a
				// few per variation. This is what keeps a large catalogue under the
				// Apps Script 6-minute execution limit on pull.
				if ( $variation_ids ) {
					_prime_post_caches( $variation_ids, false, true );
				}

				$variations = [];
				foreach ( $variation_ids as $vid ) {
					$variation = wc_get_product( $vid );
					if ( $variation ) {
						$variations[] = $variation;
					}
				}
				usort( $variations, static fn( $a, $b ) =>
					strnatcasecmp( OCTWBE_Fields::read( $a, 'variation' ), OCTWBE_Fields::read( $b, 'variation' ) ) );
				foreach ( $variations as $variation ) {
					$rows[] = $this->row( $variation, $product );
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
		foreach ( OCTWBE_Fields::columns() as $column ) {
			$row[ $column ] = OCTWBE_Fields::read( $p, $column, $parent );
		}
		return $row;
	}

	/**
	 * Apply edits. Each change carries the value the sheet last saw (`baseline`);
	 * if the live store value no longer matches that baseline, the field changed
	 * in WooCommerce since the last pull and we report a conflict instead of
	 * overwriting — unless `force` is set.
	 */
	public function push( WP_REST_Request $req ): WP_REST_Response {
		$force    = filter_var( $req->get_param( 'force' ), FILTER_VALIDATE_BOOLEAN );
		$changes  = $req->get_param( 'changes' );
		$stock_ro = (bool) get_option( 'octwbe_sync_stock_readonly', 1 );
		$map      = OCTWBE_Fields::editable_map();

		if ( ! is_array( $changes ) || ! $changes ) {
			return new WP_REST_Response( [ 'saved' => [], 'conflicts' => [], 'errors' => [ 'No changes provided.' ] ] );
		}

		$saved     = [];
		$conflicts = [];
		$errors    = [];
		$dirty     = []; // id => WC_Product, edited in place then saved once.

		foreach ( $changes as $c ) {
			$id       = (int) ( $c['id'] ?? 0 );
			$column   = sanitize_key( $c['column'] ?? '' );
			$value    = isset( $c['value'] ) ? (string) $c['value'] : '';
			$baseline = isset( $c['baseline'] ) ? (string) $c['baseline'] : '';

			if ( ! $id || $column === '' ) {
				continue;
			}

			if ( ! isset( $map[ $column ] ) ) {
				$errors[] = "Column '{$column}' is not editable.";
				continue;
			}

			if ( $column === 'stock_qty' && $stock_ro ) {
				$errors[] = "Stock is read-only on this store; skipped for product {$id}.";
				continue;
			}

			$product = $dirty[ $id ] ?? wc_get_product( $id );
			if ( ! $product ) {
				$errors[] = "Product {$id} not found.";
				continue;
			}

			$live = OCTWBE_Fields::read( $product, $column );

			if ( ! $force && ! OCTWBE_Fields::matches( $column, $live, $baseline ) ) {
				$conflicts[] = [
					'id'        => $id,
					'column'    => $column,
					'baseline'  => $baseline,
					'current'   => $live,
					'attempted' => $value,
				];
				continue;
			}

			$result = $this->editor->set_field_value( $product, $map[ $column ], $value );
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

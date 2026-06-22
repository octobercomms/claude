<?php
/**
 * Merge Products.
 *
 * Combines several existing products into one new variable product, with a
 * "Model" attribute distinguishing the sources plus the union of their Size /
 * Material (etc.) attributes. Each source variation (or a simple product itself)
 * becomes a variation of the new product, carrying over price, stock, images and
 * the Variant Showcase fields.
 *
 * Safe by construction:
 *   - Only CREATES a new product (left as a draft for review).
 *   - Originals are set to draft and 301-redirected to the new product — never
 *     deleted — so the whole operation is reversible (delete the new product,
 *     re-publish the originals).
 *   - SKUs are MOVED (cleared from originals, set on the new variations) so the
 *     live product keeps the real SKUs without tripping WooCommerce's unique-SKU
 *     rule. Past orders snapshot the SKU as text, so order history is unaffected.
 *
 * Intended to be run on staging with a fresh backup first.
 */

defined( 'ABSPATH' ) || exit;

class OctWBE_Merge {

	const REDIRECT_OPTION = 'octwbe_merge_redirects';

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'menu' ], 11 );
		add_action( 'admin_enqueue_scripts', [ $this, 'assets' ] );
		add_action( 'wp_ajax_octwbe_merge_list', [ $this, 'ajax_list' ] );
		add_action( 'wp_ajax_octwbe_merge_preview', [ $this, 'ajax_preview' ] );
		add_action( 'wp_ajax_octwbe_merge_run', [ $this, 'ajax_run' ] );
		add_action( 'template_redirect', [ $this, 'handle_redirects' ] );
	}

	public function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Merge Products', 'oct-bulk-editor' ),
			__( 'Merge Products', 'oct-bulk-editor' ),
			'manage_woocommerce',
			'oct-merge-products',
			[ $this, 'render' ]
		);
	}

	public function assets( string $hook ): void {
		if ( $hook !== 'woocommerce_page_oct-merge-products' ) {
			return;
		}
		wp_enqueue_style( 'octwbe-merge', OCTWBE_PLUGIN_URL . 'assets/css/merge.css', [], OCTWBE_VERSION );
		wp_enqueue_script( 'octwbe-merge', OCTWBE_PLUGIN_URL . 'assets/js/merge.js', [ 'jquery' ], OCTWBE_VERSION, true );
		wp_localize_script( 'octwbe-merge', 'octwbeMerge', [
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'octwbe_merge' ),
		] );
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'oct-bulk-editor' ) );
		}
		include OCTWBE_PLUGIN_DIR . 'includes/merge-page.php';
	}

	/* ---------------------------------------------------------------------
	 * AJAX: product picker list
	 * ------------------------------------------------------------------ */

	public function ajax_list(): void {
		check_ajax_referer( 'octwbe_merge', 'nonce' );
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}

		$search = sanitize_text_field( $_POST['search'] ?? '' );
		$args   = [
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => 100,
			'orderby'        => 'title',
			'order'          => 'ASC',
		];
		if ( $search !== '' ) {
			$args['s'] = $search;
		}

		$items = [];
		foreach ( ( new WP_Query( $args ) )->posts as $post ) {
			$product = wc_get_product( $post->ID );
			if ( ! $product ) {
				continue;
			}
			$items[] = [
				'id'         => $product->get_id(),
				'name'       => $product->get_name(),
				'type'       => $product->get_type(),
				'variations' => $product->is_type( 'variable' ) ? count( $product->get_children() ) : 0,
			];
		}

		wp_send_json_success( [ 'items' => $items ] );
	}

	/* ---------------------------------------------------------------------
	 * AJAX: preview (dry run)
	 * ------------------------------------------------------------------ */

	public function ajax_preview(): void {
		check_ajax_referer( 'octwbe_merge', 'nonce' );
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}

		[ $sources, $models, $error ] = $this->read_input();
		if ( $error ) {
			wp_send_json_error( $error );
		}

		$merged_attrs   = $this->collect_attributes( array_keys( $sources ) );
		$variation_rows = 0;
		$source_summary = [];

		foreach ( $sources as $sid => $product ) {
			$count            = $product->is_type( 'variable' ) ? count( $product->get_children() ) : 1;
			$variation_rows  += $count;
			$source_summary[] = [
				'name'       => $product->get_name(),
				'model'      => $models[ $sid ],
				'variations' => $count,
			];
		}

		$attribute_summary = [ [
			'label'   => __( 'Model', 'oct-bulk-editor' ),
			'values'  => count( array_unique( array_values( $models ) ) ),
		] ];
		foreach ( $merged_attrs as $info ) {
			$attribute_summary[] = [
				'label'  => $info['label'],
				'values' => count( $info['options'] ),
			];
		}

		wp_send_json_success( [
			'sources'    => $source_summary,
			'attributes' => $attribute_summary,
			'variations' => $variation_rows,
		] );
	}

	/* ---------------------------------------------------------------------
	 * AJAX: run the merge
	 * ------------------------------------------------------------------ */

	public function ajax_run(): void {
		check_ajax_referer( 'octwbe_merge', 'nonce' );
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( 'Forbidden', 403 );
		}
		if ( empty( $_POST['confirm_backup'] ) ) {
			wp_send_json_error( __( 'Please confirm you have a backup / are on staging before merging.', 'oct-bulk-editor' ) );
		}

		[ $sources, $models, $error, $title, $base_id ] = $this->read_input( true );
		if ( $error ) {
			wp_send_json_error( $error );
		}

		try {
			$result = $this->do_merge( $sources, $models, $title, $base_id );
		} catch ( \Throwable $e ) {
			wp_send_json_error( __( 'Merge failed: ', 'oct-bulk-editor' ) . $e->getMessage() );
		}

		wp_send_json_success( $result );
	}

	/* ---------------------------------------------------------------------
	 * Input parsing / validation
	 * ------------------------------------------------------------------ */

	/**
	 * @return array{0: array<int,WC_Product>, 1: array<int,string>, 2: string, 3: string, 4: int}
	 */
	private function read_input( bool $require_title = false ): array {
		$ids    = array_map( 'absint', (array) ( $_POST['sources'] ?? [] ) );
		$ids    = array_values( array_unique( array_filter( $ids ) ) );
		$models = (array) ( $_POST['models'] ?? [] );
		$title  = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
		$base   = absint( $_POST['base'] ?? 0 );

		if ( count( $ids ) < 2 ) {
			return [ [], [], __( 'Select at least two products to merge.', 'oct-bulk-editor' ), '', 0 ];
		}
		if ( $require_title && $title === '' ) {
			return [ [], [], __( 'Enter a name for the merged product.', 'oct-bulk-editor' ), '', 0 ];
		}

		$sources    = [];
		$model_map  = [];
		foreach ( $ids as $id ) {
			$product = wc_get_product( $id );
			if ( ! $product ) {
				return [ [], [], sprintf( __( 'Product %d not found.', 'oct-bulk-editor' ), $id ), '', 0 ];
			}
			$sources[ $id ]   = $product;
			$model            = sanitize_text_field( wp_unslash( $models[ $id ] ?? '' ) );
			$model_map[ $id ] = $model !== '' ? $model : $product->get_name();
		}

		if ( ! $base || ! isset( $sources[ $base ] ) ) {
			$base = (int) array_key_first( $sources );
		}

		return [ $sources, $model_map, '', $title, $base ];
	}

	/* ---------------------------------------------------------------------
	 * Attribute collection
	 * ------------------------------------------------------------------ */

	/**
	 * Union of the variation attributes across the source products.
	 *
	 * @param int[] $source_ids
	 * @return array<string,array{type:string,id:int,name:string,label:string,options:array}>
	 */
	private function collect_attributes( array $source_ids ): array {
		$merged = [];

		foreach ( $source_ids as $sid ) {
			$product = wc_get_product( $sid );
			if ( ! $product ) {
				continue;
			}
			foreach ( $product->get_attributes() as $attr ) {
				if ( ! $attr instanceof WC_Product_Attribute || ! $attr->get_variation() ) {
					continue;
				}
				if ( $attr->is_taxonomy() ) {
					$tax = $attr->get_name();
					if ( ! isset( $merged[ $tax ] ) ) {
						$merged[ $tax ] = [
							'type'    => 'taxonomy',
							'id'      => $attr->get_id(),
							'name'    => $tax,
							'label'   => wc_attribute_label( $tax ),
							'options' => [],
						];
					}
					foreach ( $attr->get_options() as $term_id ) {
						$merged[ $tax ]['options'][ (int) $term_id ] = (int) $term_id;
					}
				} else {
					$label = $attr->get_name();
					$key   = 'custom:' . sanitize_title( $label );
					if ( ! isset( $merged[ $key ] ) ) {
						$merged[ $key ] = [
							'type'    => 'custom',
							'id'      => 0,
							'name'    => $label,
							'label'   => $label,
							'options' => [],
						];
					}
					foreach ( $attr->get_options() as $opt ) {
						$merged[ $key ]['options'][ sanitize_title( $opt ) ] = $opt;
					}
				}
			}
		}

		return $merged;
	}

	/**
	 * Build the WC_Product_Attribute set (Model first, then the union).
	 *
	 * @return array<string,WC_Product_Attribute>
	 */
	private function build_wc_attributes( array $merged, array $models ): array {
		$attributes = [];

		$model = new WC_Product_Attribute();
		$model->set_name( 'Model' );
		$model->set_options( array_values( array_unique( array_values( $models ) ) ) );
		$model->set_visible( true );
		$model->set_variation( true );
		$attributes['model'] = $model;

		foreach ( $merged as $info ) {
			$attribute = new WC_Product_Attribute();
			if ( $info['type'] === 'taxonomy' ) {
				$attribute->set_id( $info['id'] );
				$attribute->set_name( $info['name'] );
				$attribute->set_options( array_values( $info['options'] ) );
				$key = $info['name'];
			} else {
				$attribute->set_name( $info['name'] );
				$attribute->set_options( array_values( $info['options'] ) );
				$key = sanitize_title( $info['name'] );
			}
			$attribute->set_visible( true );
			$attribute->set_variation( true );
			$attributes[ $key ] = $attribute;
		}

		return $attributes;
	}

	/* ---------------------------------------------------------------------
	 * The merge itself
	 * ------------------------------------------------------------------ */

	private function do_merge( array $sources, array $models, string $title, int $base_id ): array {
		$merged_attrs = $this->collect_attributes( array_keys( $sources ) );
		$wc_attrs     = $this->build_wc_attributes( $merged_attrs, $models );

		// Create the new variable product (draft, for review).
		$variable = new WC_Product_Variable();
		$variable->set_name( $title );
		$variable->set_status( 'draft' );

		$base = $sources[ $base_id ] ?? reset( $sources );
		if ( $base ) {
			$variable->set_description( $base->get_description() );
			$variable->set_short_description( $base->get_short_description() );
			$variable->set_category_ids( $base->get_category_ids() );
			if ( $base->get_image_id() ) {
				$variable->set_image_id( $base->get_image_id() );
			}
			$variable->set_gallery_image_ids( $base->get_gallery_image_ids() );
		}

		$variable->set_attributes( $wc_attrs );
		$variable->update_meta_data( '_acvs_mode', 'expand' ); // Show variations as catalogue cards.
		$new_id = $variable->save();

		if ( ! $new_id ) {
			throw new \RuntimeException( 'Could not create the merged product.' );
		}

		$created  = 0;
		$warnings = [];

		foreach ( $sources as $product ) {
			$units = $product->is_type( 'variable' )
				? array_filter( array_map( 'wc_get_product', $product->get_children() ) )
				: [ $product ];

			$model_value = $models[ $product->get_id() ];

			foreach ( $units as $unit ) {
				if ( ! $unit instanceof WC_Product ) {
					continue;
				}
				$warning = $this->create_variation( $new_id, $unit, $model_value );
				if ( $warning ) {
					$warnings[] = $warning;
				}
				$created++;
			}
		}

		WC_Product_Variable::sync( $new_id );

		// Draft + redirect the originals (capture permalink before drafting).
		$redirects = get_option( self::REDIRECT_OPTION, [] );
		if ( ! is_array( $redirects ) ) {
			$redirects = [];
		}
		foreach ( $sources as $product ) {
			$path = untrailingslashit( wp_make_link_relative( get_permalink( $product->get_id() ) ) );

			$product->set_sku( '' );
			$product->set_status( 'draft' );
			$product->save();

			if ( $path ) {
				$redirects[ $path ] = $new_id;
			}
		}
		update_option( self::REDIRECT_OPTION, $redirects, false );

		return [
			'product_id'  => $new_id,
			'edit_url'    => get_edit_post_link( $new_id, '' ),
			'created'     => $created,
			'warnings'    => $warnings,
			'attributes'  => count( $wc_attrs ),
		];
	}

	/**
	 * Create one variation on the new product from a source unit (a source
	 * variation, or a simple source product). Returns a warning string or ''.
	 */
	private function create_variation( int $new_id, WC_Product $unit, string $model_value ): string {
		$variation = new WC_Product_Variation();
		$variation->set_parent_id( $new_id );

		// Attribute map: Model + whatever the source unit already carries.
		$attrs = [ 'model' => $model_value ];
		if ( $unit instanceof WC_Product_Variation ) {
			foreach ( $unit->get_attributes() as $name => $value ) {
				if ( $value !== '' && $value !== null ) {
					$attrs[ $name ] = $value;
				}
			}
		}
		$variation->set_attributes( $attrs );

		// Copy core fields.
		$variation->set_regular_price( $unit->get_regular_price() );
		$variation->set_sale_price( $unit->get_sale_price() );
		$variation->set_manage_stock( $unit->get_manage_stock() );
		$variation->set_stock_quantity( $unit->get_stock_quantity() );
		$variation->set_stock_status( $unit->get_stock_status() );
		$variation->set_backorders( $unit->get_backorders() );
		$variation->set_weight( $unit->get_weight() );
		$variation->set_length( $unit->get_length() );
		$variation->set_width( $unit->get_width() );
		$variation->set_height( $unit->get_height() );
		$variation->set_tax_class( $unit->get_tax_class() );
		$variation->set_shipping_class_id( $unit->get_shipping_class_id() );
		$variation->set_description( $unit->get_description() );
		if ( $unit->get_image_id() ) {
			$variation->set_image_id( $unit->get_image_id() );
		}

		// Carry over Variant Showcase fields.
		$lifestyle = $unit->get_meta( '_acvs_lifestyle_image_id' );
		if ( $lifestyle ) {
			$variation->update_meta_data( '_acvs_lifestyle_image_id', $lifestyle );
		}
		$show = $unit->get_meta( '_acvs_show_in_catalog' );
		if ( $show ) {
			$variation->update_meta_data( '_acvs_show_in_catalog', $show );
		}

		// Move the SKU: clear it on the source, set it on the new variation.
		$warning = '';
		$sku     = $unit->get_sku();
		if ( $sku !== '' ) {
			$unit->set_sku( '' );
			$unit->save();
			try {
				$variation->set_sku( $sku );
			} catch ( WC_Data_Exception $e ) {
				$warning = sprintf( __( 'Could not set SKU "%s" (left blank).', 'oct-bulk-editor' ), $sku );
			}
		}

		$variation->save();

		return $warning;
	}

	/* ---------------------------------------------------------------------
	 * 301 redirects for the retired originals
	 * ------------------------------------------------------------------ */

	public function handle_redirects(): void {
		if ( is_admin() ) {
			return;
		}
		$map = get_option( self::REDIRECT_OPTION, [] );
		if ( empty( $map ) || ! is_array( $map ) ) {
			return;
		}
		$request = untrailingslashit( strtok( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), '?' ) );
		if ( $request === '' || ! isset( $map[ $request ] ) ) {
			return;
		}
		$target = get_permalink( (int) $map[ $request ] );
		if ( $target ) {
			wp_safe_redirect( $target, 301 );
			exit;
		}
	}
}

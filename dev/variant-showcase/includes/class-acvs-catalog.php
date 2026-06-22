<?php
/**
 * Front-end catalog behaviour:
 *   1. Expand flagged variable products into one card per selected variation
 *      (or feature a single chosen variation) within the shop/category loop.
 *   2. Swap each card's image to its lifestyle image on hover (CSS-driven).
 *
 * The expansion works by substituting `product_variation` posts into the loop's
 * post list. WooCommerce already sets the global `$product` from whatever post
 * is being rendered, and a `WC_Product_Variation` exposes its own image, name,
 * price, permalink (parent URL with the variation pre-selected) and add-to-cart
 * URL — so the theme renders each variation as an ordinary product card without
 * any template overrides.
 */

defined( 'ABSPATH' ) || exit;

class ACVS_Catalog {

	/** True only while a single shop-loop card is being rendered. */
	private bool $in_loop = false;

	public function __construct() {
		// Expand the loop's posts into variation cards.
		add_filter( 'the_posts', [ $this, 'expand_loop_posts' ], 10, 2 );

		// Scope image/title overrides to the loop card currently rendering.
		add_action( 'woocommerce_before_shop_loop_item', [ $this, 'open_loop_item' ], 0 );
		add_action( 'woocommerce_after_shop_loop_item', [ $this, 'close_loop_item' ], 999 );

		// Give variation cards a readable title (variation posts have no useful post_title).
		add_filter( 'the_title', [ $this, 'variation_loop_title' ], 10, 2 );

		// Lifestyle hover image — hook both the WooCommerce image method and the
		// core post-thumbnail filter so it works whichever the theme uses.
		add_filter( 'woocommerce_product_get_image', [ $this, 'add_lifestyle_image' ], 10, 5 );
		add_filter( 'post_thumbnail_html', [ $this, 'add_lifestyle_to_thumbnail' ], 10, 5 );

		// Front-end styles.
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue' ] );
	}

	/* ---------------------------------------------------------------------
	 * Loop expansion
	 * ------------------------------------------------------------------ */

	/**
	 * Replace flagged variable products in a product loop with their selected
	 * variation posts. Non-product loops and the admin are left untouched.
	 *
	 * @param array     $posts Posts returned by the query.
	 * @param \WP_Query $query The query.
	 * @return array
	 */
	public function expand_loop_posts( $posts, $query ) {
		// Never expand in the admin. This includes admin-ajax requests such as
		// the bulk editor's product fetch — expanding there would replace a
		// variable product with its variation posts and corrupt the grid.
		if ( is_admin() ) {
			return $posts;
		}
		if ( empty( $posts ) || is_feed() || ! $this->is_product_loop( $query ) ) {
			return $posts;
		}

		$expanded = [];

		foreach ( $posts as $post ) {
			if ( ! isset( $post->post_type ) || $post->post_type !== 'product' ) {
				$expanded[] = $post;
				continue;
			}

			$product = wc_get_product( $post->ID );
			if ( ! $product instanceof WC_Product || ! $product->is_type( 'variable' ) ) {
				$expanded[] = $post;
				continue;
			}

			$mode = $product->get_meta( ACVS_META_MODE ) ?: 'default';

			if ( $mode === 'expand' ) {
				$cards = $this->variation_cards( $product );
				if ( $cards ) {
					array_push( $expanded, ...$cards );
				} else {
					$expanded[] = $post; // Nothing flagged/visible — fall back to the normal card.
				}
			} elseif ( $mode === 'single' ) {
				$card = $this->single_variation_card( $product );
				$expanded[] = $card ?: $post;
			} else {
				$expanded[] = $post;
			}
		}

		return $expanded;
	}

	/** Should this query be treated as a shop/category product loop? */
	private function is_product_loop( $query ): bool {
		if ( ! $query instanceof WP_Query ) {
			return false;
		}
		// Never expand a single product page or search-as-singular.
		if ( $query->is_singular() ) {
			return false;
		}

		$post_types = (array) $query->get( 'post_type' );

		$is_main_shop = $query->is_main_query()
			&& function_exists( 'is_shop' )
			&& ( is_shop() || is_product_taxonomy() );

		// Covers the [products] shortcode and product blocks (secondary queries).
		$is_product_secondary = in_array( 'product', $post_types, true );

		return $is_main_shop || $is_product_secondary;
	}

	/**
	 * Variation posts to show as cards for an "expand" product: those ticked
	 * "show in catalog" (or, if none are ticked, every visible variation).
	 *
	 * @return WP_Post[]
	 */
	private function variation_cards( WC_Product $product ): array {
		$selected = [];
		$fallback = [];

		foreach ( $product->get_children() as $variation_id ) {
			$variation = wc_get_product( $variation_id );
			if ( ! $variation instanceof WC_Product_Variation || ! $this->variation_is_showable( $variation ) ) {
				continue;
			}

			$post = get_post( $variation_id );
			if ( ! $post ) {
				continue;
			}

			$fallback[] = $post;
			if ( $variation->get_meta( ACVS_META_SHOW ) === 'yes' ) {
				$selected[] = $post;
			}
		}

		return $selected ?: $fallback;
	}

	/** The chosen single-variation card for a "single" product, or null. */
	private function single_variation_card( WC_Product $product ): ?WP_Post {
		$variation_id = absint( $product->get_meta( ACVS_META_SINGLE ) );
		if ( ! $variation_id ) {
			return null;
		}

		$variation = wc_get_product( $variation_id );
		if ( ! $variation instanceof WC_Product_Variation
			|| $variation->get_parent_id() !== $product->get_id()
			|| ! $this->variation_is_showable( $variation ) ) {
			return null;
		}

		return get_post( $variation_id ) ?: null;
	}

	private function variation_is_showable( WC_Product_Variation $variation ): bool {
		if ( method_exists( $variation, 'variation_is_visible' ) && ! $variation->variation_is_visible() ) {
			return false;
		}
		return $variation->exists();
	}

	/* ---------------------------------------------------------------------
	 * Per-card scoping + variation title
	 * ------------------------------------------------------------------ */

	public function open_loop_item(): void {
		$this->in_loop = true;
	}

	public function close_loop_item(): void {
		$this->in_loop = false;
	}

	/**
	 * Whether we are rendering a product card in a catalogue loop.
	 *
	 * Primary signal is the woocommerce_before/after_shop_loop_item hooks. As a
	 * fallback for custom themes that render loop thumbnails without firing those
	 * hooks, trust WordPress's own loop flag while on a shop/category archive
	 * (never on a single product page or in the admin).
	 */
	private function is_in_catalog_loop(): bool {
		if ( $this->in_loop ) {
			return true;
		}
		if ( is_admin() || is_singular() ) {
			return false;
		}
		return in_the_loop() && ( is_shop() || is_product_taxonomy() );
	}

	/**
	 * Variation posts carry no useful post_title, so substitute the WooCommerce
	 * product name (e.g. "Series 1 Sofa – 3 Seater") for the loop card heading.
	 */
	public function variation_loop_title( $title, $id = 0 ) {
		if ( ! $this->is_in_catalog_loop() || ! $id || get_post_type( $id ) !== 'product_variation' ) {
			return $title;
		}
		$variation = wc_get_product( $id );
		return $variation ? $variation->get_name() : $title;
	}

	/* ---------------------------------------------------------------------
	 * Lifestyle hover image
	 * ------------------------------------------------------------------ */

	/**
	 * Filter for `woocommerce_product_get_image` — used by themes that render the
	 * loop thumbnail via `$product->get_image()`.
	 *
	 * @param string     $html        Existing image markup.
	 * @param WC_Product $product     Product (or variation) being rendered.
	 * @param string     $size        Requested image size.
	 * @param array      $attr        Image attributes.
	 * @param bool       $placeholder Whether a placeholder may be used.
	 * @return string
	 */
	public function add_lifestyle_image( $html, $product, $size, $attr, $placeholder ) {
		if ( ! $this->is_in_catalog_loop() || ! $product instanceof WC_Product ) {
			return $html;
		}
		if ( strpos( (string) $html, 'acvs-image-swap' ) !== false ) {
			return $html; // Already wrapped.
		}
		return $this->wrap_with_lifestyle( (string) $html, $product, $size );
	}

	/**
	 * Filter for `post_thumbnail_html` — covers themes that render the loop
	 * thumbnail via `the_post_thumbnail()` / `get_the_post_thumbnail()` rather
	 * than `$product->get_image()`.
	 *
	 * @param string $html         Featured-image markup.
	 * @param int    $post_id      Post being rendered.
	 * @param int    $thumbnail_id Attachment ID.
	 * @param string|array $size   Requested size.
	 * @param array  $attr         Image attributes.
	 * @return string
	 */
	public function add_lifestyle_to_thumbnail( $html, $post_id, $thumbnail_id, $size, $attr ) {
		if ( (string) $html === '' || ! $this->is_in_catalog_loop() ) {
			return $html;
		}
		if ( strpos( (string) $html, 'acvs-image-swap' ) !== false ) {
			return $html; // Already wrapped (e.g. via woocommerce_product_get_image).
		}
		$type = get_post_type( $post_id );
		if ( $type !== 'product' && $type !== 'product_variation' ) {
			return $html;
		}
		$product = wc_get_product( $post_id );
		if ( ! $product instanceof WC_Product ) {
			return $html;
		}
		return $this->wrap_with_lifestyle( (string) $html, $product, $size );
	}

	/**
	 * Wrap a thumbnail in the swap span with the product/variation's lifestyle
	 * image layered on top for the CSS hover crossfade. Returns the original
	 * markup unchanged when there is no lifestyle image.
	 *
	 * @param string     $html    Existing thumbnail markup.
	 * @param WC_Product $product Product or variation.
	 * @param string|array $size  Requested image size.
	 * @return string
	 */
	private function wrap_with_lifestyle( string $html, WC_Product $product, $size ): string {
		$lifestyle_id = absint( $product->get_meta( ACVS_META_LIFESTYLE ) );
		if ( ! $lifestyle_id ) {
			return $html;
		}

		$image_size = $size ?: 'woocommerce_thumbnail';
		$lifestyle  = wp_get_attachment_image(
			$lifestyle_id,
			$image_size,
			false,
			[
				'class'       => 'acvs-lifestyle-image',
				'aria-hidden' => 'true',
				'loading'     => 'lazy',
				'alt'         => '',
			]
		);

		if ( ! $lifestyle ) {
			return $html;
		}

		return '<span class="acvs-image-swap">' . $html . $lifestyle . '</span>';
	}

	/* ---------------------------------------------------------------------
	 * Assets
	 * ------------------------------------------------------------------ */

	public function enqueue(): void {
		if ( ! function_exists( 'is_shop' ) ) {
			return;
		}
		if ( is_shop() || is_product_taxonomy() || is_product() ) {
			wp_enqueue_style( 'acvs-frontend', ACVS_URL . 'assets/css/frontend.css', [], ACVS_VERSION );
		}
	}
}

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

		// Lifestyle hover image.
		add_filter( 'woocommerce_product_get_image', [ $this, 'add_lifestyle_image' ], 10, 5 );

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
		if ( is_admin() && ! wp_doing_ajax() ) {
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
	 * Variation posts carry no useful post_title, so substitute the WooCommerce
	 * product name (e.g. "Series 1 Sofa – 3 Seater") for the loop card heading.
	 */
	public function variation_loop_title( $title, $id = 0 ) {
		if ( ! $this->in_loop || ! $id || get_post_type( $id ) !== 'product_variation' ) {
			return $title;
		}
		$variation = wc_get_product( $id );
		return $variation ? $variation->get_name() : $title;
	}

	/* ---------------------------------------------------------------------
	 * Lifestyle hover image
	 * ------------------------------------------------------------------ */

	/**
	 * Append the lifestyle image as a second <img> inside the loop thumbnail so
	 * CSS can crossfade to it on hover. Reads the variation's own lifestyle image
	 * for variation cards, or the product's for normal cards.
	 *
	 * @param string     $html        Existing image markup.
	 * @param WC_Product $product     Product (or variation) being rendered.
	 * @param string     $size        Requested image size.
	 * @param array      $attr        Image attributes.
	 * @param bool       $placeholder Whether a placeholder may be used.
	 * @return string
	 */
	public function add_lifestyle_image( $html, $product, $size, $attr, $placeholder ) {
		if ( ! $this->in_loop || ! $product instanceof WC_Product ) {
			return $html;
		}

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

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

	/** Lifestyle images for products/variations rendered on the current page,
	 *  keyed by post ID: [ id => [ 'img' => url, 'href' => permalink ] ].
	 *  Used by the JS fallback to attach the hover overlay theme-independently. */
	private array $lifestyle_data = [];

	/** Per-request memo of an expand product's resolved variation cards, keyed by
	 *  product ID, so a product appearing in more than one loop on a page (e.g. the
	 *  main archive and a product block) is resolved only once. */
	private array $card_cache = [];

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

		// Collect lifestyle images for every card in the loop so the JS fallback
		// can attach the hover overlay even on themes that render thumbnails in a
		// way the two image filters above don't intercept.
		add_action( 'the_post', [ $this, 'collect_lifestyle' ], 10, 2 );
		add_action( 'wp_footer', [ $this, 'print_lifestyle_data' ], 5 );

		// Front-end assets.
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

		$expanded     = [];
		$expanded_any = false;

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
					$expanded_any = true;
				} else {
					$expanded[] = $post; // Nothing flagged/visible — fall back to the normal card.
				}
			} elseif ( $mode === 'single' ) {
				$card = $this->single_variation_card( $product );
				if ( $card ) {
					$expanded[]   = $card;
					$expanded_any = true;
				} else {
					$expanded[] = $post;
				}
			} else {
				$expanded[] = $post;
			}
		}

		// Nothing was expanded → the query's own ordering already applies, so skip
		// the re-sort (and its per-post meta reads) entirely. Plain catalogue pages
		// with no expand/single products pay no measurable cost from this filter.
		if ( ! $expanded_any ) {
			return $expanded;
		}

		// Apply the curated catalogue order — but only for the default view. If a
		// shopper has explicitly chosen a sort (price, popularity, …) respect it.
		$chosen = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : '';
		if ( $chosen === '' || strpos( $chosen, 'menu_order' ) === 0 ) {
			$expanded = $this->sort_by_catalog_order( $expanded );
		}

		return $expanded;
	}

	/**
	 * Stable-sort the expanded loop by catalogue order so individual variation
	 * cards can be interleaved with other products. Effective order is:
	 *   - product card        → its menu_order
	 *   - variation card      → its _acvs_catalog_order meta, or (unset) the
	 *                           parent product's menu_order so it stays put.
	 * Ties keep WooCommerce's original order (lower number shows first).
	 *
	 * @param WP_Post[] $posts
	 * @return WP_Post[]
	 */
	private function sort_by_catalog_order( array $posts ): array {
		$indexed      = [];
		$parent_cache = [];
		$seq          = 0;

		foreach ( $posts as $post ) {
			$order = 0;

			if ( isset( $post->post_type ) && $post->post_type === 'product_variation' ) {
				$meta = get_post_meta( $post->ID, ACVS_META_CATALOG_ORDER, true );
				if ( $meta !== '' && is_numeric( $meta ) ) {
					$order = (int) $meta;
				} else {
					$pid = (int) ( $post->post_parent ?? 0 );
					if ( ! array_key_exists( $pid, $parent_cache ) ) {
						$parent_post          = $pid ? get_post( $pid ) : null;
						$parent_cache[ $pid ] = $parent_post ? (int) $parent_post->menu_order : 0;
					}
					$order = $parent_cache[ $pid ];
				}
			} else {
				$order = isset( $post->menu_order ) ? (int) $post->menu_order : 0;
			}

			$indexed[] = [ 'post' => $post, 'order' => $order, 'seq' => $seq++ ];
		}

		usort( $indexed, static function ( $a, $b ) {
			return $a['order'] === $b['order']
				? $a['seq'] <=> $b['seq']
				: $a['order'] <=> $b['order'];
		} );

		return array_map( static fn( $row ) => $row['post'], $indexed );
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
		$product_id = $product->get_id();
		if ( isset( $this->card_cache[ $product_id ] ) ) {
			return $this->card_cache[ $product_id ];
		}

		$children = $product->get_children();
		if ( ! $children ) {
			return $this->card_cache[ $product_id ] = [];
		}

		// Prime the post + meta caches for every variation in one pair of queries,
		// so the "show in catalog" reads below — and the downstream card rendering
		// (image, title, price) — never hit the database per variation. Without this
		// a range with hundreds of variations costs hundreds of queries on every
		// catalogue render.
		_prime_post_caches( $children, false, true );

		// The ticked "show as its own card" variations are the common case for an
		// expand product. This flag read comes from the primed meta cache, so the
		// loop runs no queries.
		$ticked = [];
		foreach ( $children as $variation_id ) {
			if ( get_post_meta( $variation_id, ACVS_META_SHOW, true ) === 'yes' ) {
				$ticked[] = $variation_id;
			}
		}

		// Hydrate only the ticked variations first — a sofa with 6 ticked cards out
		// of 384 variations builds 6 product objects, not 384.
		$selected = $this->showable_posts( $ticked );
		if ( $selected ) {
			return $this->card_cache[ $product_id ] = $selected;
		}

		// Tick none (or none of the ticked are currently showable) → show every
		// visible variation, exactly as documented. Caches are already primed, so
		// this fallback is still far cheaper than before.
		return $this->card_cache[ $product_id ] = $this->showable_posts( $children );
	}

	/**
	 * Map variation IDs to their WP_Post objects, keeping only variations that are
	 * currently showable (published + visible/purchasable). Assumes the post and
	 * meta caches for these IDs have already been primed by the caller.
	 *
	 * @param int[] $variation_ids
	 * @return WP_Post[]
	 */
	private function showable_posts( array $variation_ids ): array {
		$posts = [];
		foreach ( $variation_ids as $variation_id ) {
			$variation = wc_get_product( $variation_id );
			if ( ! $variation instanceof WC_Product_Variation || ! $this->variation_is_showable( $variation ) ) {
				continue;
			}
			$post = get_post( $variation_id );
			if ( $post ) {
				$posts[] = $post;
			}
		}
		return $posts;
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
		if ( ! $this->is_in_catalog_loop() || ! $id ) {
			return $title;
		}
		$type = get_post_type( $id );
		if ( $type !== 'product_variation' && $type !== 'product' ) {
			return $title;
		}
		$product = wc_get_product( $id );
		if ( ! $product instanceof WC_Product ) {
			return $title;
		}
		// A custom catalogue card title wins, for products and variation cards alike.
		$custom = trim( (string) $product->get_meta( ACVS_META_CARD_TITLE ) );
		if ( $custom !== '' ) {
			return $custom;
		}
		// Variation posts carry no useful post_title — use the WooCommerce product name.
		if ( $type === 'product_variation' ) {
			return $product->get_name();
		}
		return $title;
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
	 * JS fallback data
	 * ------------------------------------------------------------------ */

	/**
	 * Record the lifestyle image for each product/variation as it is set up in
	 * the main archive loop. Fires for every card regardless of how the theme
	 * renders it, so the JS fallback can always find a match.
	 *
	 * @param WP_Post        $post  Current post.
	 * @param WP_Query|null  $query The query (passed since WP 4.x).
	 */
	public function collect_lifestyle( $post, $query = null ): void {
		if ( is_admin() || ! $post instanceof WP_Post ) {
			return;
		}
		if ( $query instanceof WP_Query && ! $query->is_main_query() ) {
			return;
		}
		if ( ! function_exists( 'is_shop' ) || ! ( is_shop() || is_product_taxonomy() ) ) {
			return;
		}
		if ( $post->post_type !== 'product' && $post->post_type !== 'product_variation' ) {
			return;
		}
		if ( isset( $this->lifestyle_data[ $post->ID ] ) ) {
			return;
		}

		$product = wc_get_product( $post->ID );
		if ( ! $product instanceof WC_Product ) {
			return;
		}
		$lifestyle_id = absint( $product->get_meta( ACVS_META_LIFESTYLE ) );
		if ( ! $lifestyle_id ) {
			return;
		}
		$url = wp_get_attachment_image_url( $lifestyle_id, 'woocommerce_thumbnail' );
		if ( ! $url ) {
			return;
		}

		$this->lifestyle_data[ $post->ID ] = [
			'img'  => $url,
			'href' => $product->get_permalink(),
		];
	}

	/** Print the collected lifestyle map for the JS fallback. */
	public function print_lifestyle_data(): void {
		if ( empty( $this->lifestyle_data ) ) {
			return;
		}
		echo '<script id="acvs-lifestyle-data">window.acvsLifestyle = '
			. wp_json_encode( $this->lifestyle_data )
			. ';</script>' . "\n";
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
			wp_enqueue_script( 'acvs-frontend', ACVS_URL . 'assets/js/frontend.js', [], ACVS_VERSION, true );
		}
	}
}

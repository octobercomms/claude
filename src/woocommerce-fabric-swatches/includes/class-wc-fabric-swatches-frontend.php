<?php
defined( 'ABSPATH' ) || exit;

/**
 * Frontend output for the Fabric Swatches plugin.
 *
 * - Hides the CartFlows / Variation Swatches row for the chosen attribute.
 * - Adds a drawer trigger in the product summary.
 * - Renders the right-side drawer with swatches grouped by category.
 * - Passes the attribute input name to JS so clicking a swatch drives the
 *   native WooCommerce variation selector (price update, cart, gallery image).
 */
class WC_Fabric_Swatches_Frontend {

	/** Cached result of get_product_data() – populated on first call. */
	private $product_data = null;
	private $data_fetched  = false;

	public function __construct() {
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
		add_action( 'woocommerce_single_product_summary', [ $this, 'render_trigger' ], 25 );
		add_action( 'woocommerce_single_product_summary', [ $this, 'render_note' ], 26 );
		add_action( 'wp_footer', [ $this, 'render_drawer' ] );
	}

	// -------------------------------------------------------------------------
	// Scripts
	// -------------------------------------------------------------------------

	public function enqueue_scripts() {
		if ( ! is_product() ) {
			return;
		}

		// Only load assets when this product actually has swatches configured
		$product_id = get_queried_object_id();
		if ( ! get_post_meta( $product_id, '_fabric_swatch_attribute', true ) ) {
			return;
		}

		wp_enqueue_style(
			'wc-fabric-swatches',
			WC_FABRIC_SWATCHES_URL . 'assets/css/frontend.css',
			[],
			WC_FABRIC_SWATCHES_VERSION
		);

		wp_enqueue_script(
			'wc-fabric-swatches',
			WC_FABRIC_SWATCHES_URL . 'assets/js/frontend.js',
			[ 'jquery' ],
			WC_FABRIC_SWATCHES_VERSION,
			true
		);
	}

	// -------------------------------------------------------------------------
	// Product data helper
	// -------------------------------------------------------------------------

	private function get_product_data() {
		if ( $this->data_fetched ) {
			return $this->product_data;
		}

		$this->data_fetched = true;

		global $product;
		if ( ! $product ) {
			return null;
		}

		$attribute = get_post_meta( $product->get_id(), '_fabric_swatch_attribute', true );
		$groups    = get_post_meta( $product->get_id(), '_fabric_swatch_groups', true );

		if ( ! $attribute || empty( $groups ) ) {
			return null;
		}

		// Build a term lookup: slug → { name, imageUrl, color }
		$terms        = [];
		$product_terms = wc_get_product_terms( $product->get_id(), $attribute, [ 'fields' => 'all' ] );

		foreach ( $product_terms as $term ) {
			$image_id = (int) get_term_meta( $term->term_id, 'product_attribute_image', true );
			$color    = get_term_meta( $term->term_id, 'product_attribute_color', true );

			$terms[ $term->slug ] = [
				'name'     => $term->name,
				'imageUrl' => $image_id ? wp_get_attachment_image_url( $image_id, 'thumbnail' ) : '',
				'color'    => $color ?: '',
			];
		}

		$this->product_data = [
			'attribute'      => $attribute,
			// The name of the <select> WooCommerce uses in the variations form
			'attributeInput' => 'attribute_' . $attribute,
			'groups'         => $groups,
			'terms'          => $terms,
		];

		return $this->product_data;
	}

	// -------------------------------------------------------------------------
	// Trigger + note (in product summary)
	// -------------------------------------------------------------------------

	public function render_trigger() {
		if ( ! $this->get_product_data() ) {
			return;
		}
		?>
		<div class="wc-fabric-swatches-trigger-wrap">
			<div class="wc-fabric-swatches-selected">
				<span class="wc-fabric-swatches-selected-preview" aria-hidden="true"></span>
				<span class="wc-fabric-swatches-selected-name">
					<?php esc_html_e( 'Select a fabric', 'wc-fabric-swatches' ); ?>
				</span>
			</div>
			<button type="button" class="wc-fabric-swatches-open-drawer button alt">
				<?php esc_html_e( 'View Fabrics', 'wc-fabric-swatches' ); ?>
			</button>
		</div>
		<?php
	}

	public function render_note() {
		if ( ! $this->get_product_data() ) {
			return;
		}
		?>
		<p class="wc-fabric-swatches-note">
			<?php esc_html_e( 'Further swatches available in store or on request', 'wc-fabric-swatches' ); ?>
		</p>
		<?php
	}

	// -------------------------------------------------------------------------
	// Drawer (footer)
	// -------------------------------------------------------------------------

	public function render_drawer() {
		if ( ! is_product() ) {
			return;
		}

		$data = $this->get_product_data();
		if ( ! $data ) {
			return;
		}

		$groups = $data['groups'];
		$terms  = $data['terms'];

		// Inline JS config – tells frontend.js which <select> to drive and which
		// CartFlows wrapper to hide.
		wp_add_inline_script(
			'wc-fabric-swatches',
			'var wcFabricSwatches = ' . wp_json_encode( [
				'attributeInput' => $data['attributeInput'],
			] ) . ';',
			'before'
		);
		?>

		<div class="wc-fabric-swatches-overlay" aria-hidden="true"></div>

		<div class="wc-fabric-swatches-drawer"
			role="dialog"
			aria-modal="true"
			aria-label="<?php esc_attr_e( 'Fabric Swatches', 'wc-fabric-swatches' ); ?>"
			aria-hidden="true">

			<div class="wc-fabric-swatches-drawer-header">
				<h2 class="wc-fabric-swatches-drawer-title">
					<?php esc_html_e( 'Choose Your Fabric', 'wc-fabric-swatches' ); ?>
				</h2>
				<button type="button"
					class="wc-fabric-swatches-close"
					aria-label="<?php esc_attr_e( 'Close fabric swatches', 'wc-fabric-swatches' ); ?>">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
						<path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				</button>
			</div>

			<div class="wc-fabric-swatches-drawer-body">
				<?php foreach ( $groups as $group ) : ?>
					<?php
					$slugs       = $group['term_slugs'] ?? [];
					$group_terms = [];

					foreach ( $slugs as $slug ) {
						if ( isset( $terms[ $slug ] ) ) {
							$group_terms[] = array_merge( [ 'slug' => $slug ], $terms[ $slug ] );
						}
					}

					if ( empty( $group_terms ) ) {
						continue;
					}
					?>
					<div class="wc-fabric-swatches-group">

						<div class="wc-fabric-swatches-group-heading">
							<?php if ( ! empty( $group['title'] ) ) : ?>
								<h3 class="wc-fabric-swatches-group-name">
									<?php echo esc_html( $group['title'] ); ?>
								</h3>
							<?php endif; ?>
							<?php if ( ! empty( $group['price_label'] ) ) : ?>
								<span class="wc-fabric-swatches-group-price">
									<?php echo esc_html( $group['price_label'] ); ?>
								</span>
							<?php endif; ?>
						</div>

						<?php if ( ! empty( $group['description'] ) ) : ?>
							<p class="wc-fabric-swatches-group-desc">
								<?php echo esc_html( $group['description'] ); ?>
							</p>
						<?php endif; ?>

						<div class="wc-fabric-swatches-grid">
							<?php foreach ( $group_terms as $term ) : ?>
								<button type="button"
									class="wc-fabric-swatch-btn"
									data-term="<?php echo esc_attr( $term['slug'] ); ?>"
									aria-label="<?php echo esc_attr( $term['name'] ); ?>"
									aria-pressed="false">

									<span class="wc-fabric-swatch-tile">
										<?php if ( ! empty( $term['imageUrl'] ) ) : ?>
											<img src="<?php echo esc_url( $term['imageUrl'] ); ?>"
												alt="<?php echo esc_attr( $term['name'] ); ?>"
												loading="lazy">
										<?php elseif ( ! empty( $term['color'] ) ) : ?>
											<span class="wc-fabric-swatch-color"
												style="background:<?php echo esc_attr( $term['color'] ); ?>"></span>
										<?php else : ?>
											<span class="wc-fabric-swatch-placeholder"></span>
										<?php endif; ?>
									</span>

									<span class="wc-fabric-swatch-name">
										<?php echo esc_html( $term['name'] ); ?>
									</span>

								</button>
							<?php endforeach; ?>
						</div>

					</div>
				<?php endforeach; ?>
			</div>

		</div>
		<?php
	}
}

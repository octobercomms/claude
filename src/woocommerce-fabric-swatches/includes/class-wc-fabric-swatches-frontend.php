<?php
defined( 'ABSPATH' ) || exit;

class WC_Fabric_Swatches_Frontend {

	public function __construct() {
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
		// Hook into the product summary – priority 25 sits after the price, before add-to-cart
		add_action( 'woocommerce_single_product_summary', [ $this, 'render_swatch_trigger' ], 25 );
		add_action( 'woocommerce_single_product_summary', [ $this, 'render_further_swatches_note' ], 26 );
		add_action( 'wp_footer', [ $this, 'render_drawer' ] );
	}

	// -------------------------------------------------------------------------
	// Scripts & styles
	// -------------------------------------------------------------------------

	public function enqueue_scripts() {
		if ( ! is_product() ) {
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
	// Helpers
	// -------------------------------------------------------------------------

	private function get_groups() {
		global $product;
		if ( ! $product ) {
			return [];
		}
		$groups = get_post_meta( $product->get_id(), '_fabric_swatch_groups', true );
		return is_array( $groups ) ? $groups : [];
	}

	// -------------------------------------------------------------------------
	// Trigger (shown in product summary)
	// -------------------------------------------------------------------------

	public function render_swatch_trigger() {
		$groups = $this->get_groups();
		if ( empty( $groups ) ) {
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

	public function render_further_swatches_note() {
		if ( empty( $this->get_groups() ) ) {
			return;
		}
		?>
		<p class="wc-fabric-swatches-note">
			<?php esc_html_e( 'Further swatches available in store or on request', 'wc-fabric-swatches' ); ?>
		</p>
		<?php
	}

	// -------------------------------------------------------------------------
	// Drawer (injected into footer)
	// -------------------------------------------------------------------------

	public function render_drawer() {
		if ( ! is_product() ) {
			return;
		}

		$groups = $this->get_groups();
		if ( empty( $groups ) ) {
			return;
		}

		// Build a JS data map: swatch key → { productImage, fabricImage, name }
		$swatch_data = [];
		foreach ( $groups as $gi => $group ) {
			foreach ( ( $group['swatches'] ?? [] ) as $si => $swatch ) {
				$key = "g{$gi}s{$si}";

				$fabric_img_url  = '';
				$product_img_url = '';

				if ( ! empty( $swatch['fabric_image_id'] ) ) {
					$fabric_img_url = wp_get_attachment_image_url( (int) $swatch['fabric_image_id'], 'thumbnail' );
				}
				if ( ! empty( $swatch['product_image_id'] ) ) {
					$product_img_url = wp_get_attachment_image_url( (int) $swatch['product_image_id'], 'woocommerce_single' );
				}

				$swatch_data[ $key ] = [
					'fabricImage'  => $fabric_img_url  ?: '',
					'productImage' => $product_img_url ?: '',
					'name'         => $swatch['name'] ?? '',
				];
			}
		}

		wp_add_inline_script(
			'wc-fabric-swatches',
			'var wcFabricSwatches = ' . wp_json_encode( [ 'swatches' => $swatch_data ] ) . ';',
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
				<?php foreach ( $groups as $gi => $group ) : ?>
					<?php
					$swatches = $group['swatches'] ?? [];
					if ( empty( $swatches ) ) {
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
							<?php foreach ( $swatches as $si => $swatch ) : ?>
								<?php
								$key           = "g{$gi}s{$si}";
								$fabric_url    = '';
								if ( ! empty( $swatch['fabric_image_id'] ) ) {
									$fabric_url = wp_get_attachment_image_url( (int) $swatch['fabric_image_id'], 'thumbnail' );
								}
								$swatch_name = $swatch['name'] ?? '';
								?>
								<button type="button"
									class="wc-fabric-swatch-btn"
									data-swatch="<?php echo esc_attr( $key ); ?>"
									aria-label="<?php echo esc_attr( $swatch_name ); ?>"
									aria-pressed="false">

									<span class="wc-fabric-swatch-tile">
										<?php if ( $fabric_url ) : ?>
											<img src="<?php echo esc_url( $fabric_url ); ?>"
												alt="<?php echo esc_attr( $swatch_name ); ?>"
												loading="lazy">
										<?php else : ?>
											<span class="wc-fabric-swatch-placeholder"></span>
										<?php endif; ?>
									</span>

									<span class="wc-fabric-swatch-name">
										<?php echo esc_html( $swatch_name ); ?>
									</span>

									<?php if ( ! empty( $swatch['price_label'] ) ) : ?>
										<span class="wc-fabric-swatch-price">
											<?php echo esc_html( $swatch['price_label'] ); ?>
										</span>
									<?php endif; ?>

								</button>
							<?php endforeach; ?>
						</div>

					</div>
				<?php endforeach; ?>
			</div><!-- .wc-fabric-swatches-drawer-body -->

		</div><!-- .wc-fabric-swatches-drawer -->
		<?php
	}
}

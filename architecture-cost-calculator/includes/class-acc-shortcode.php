<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACC_Shortcode {

	public function __construct() {
		add_shortcode( 'arch_cost_calculator', [ $this, 'render' ] );
		add_action( 'wp_enqueue_scripts', [ $this, 'register_assets' ] );
	}

	public function register_assets(): void {
		wp_register_style(
			'acc-frontend',
			ACC_PLUGIN_URL . 'assets/css/acc-frontend.css',
			[],
			ACC_VERSION
		);

		wp_register_script(
			'acc-calculator',
			ACC_PLUGIN_URL . 'assets/js/acc-calculator.js',
			[],
			ACC_VERSION,
			true
		);
	}

	public function render( mixed $atts ): string {
		wp_enqueue_style( 'acc-frontend' );
		wp_enqueue_script( 'acc-calculator' );

		$settings      = ACC_Calculator::get_settings();
		$project_types = ACC_Calculator::get_project_types();
		$spec_levels   = ACC_Calculator::get_spec_levels();

		wp_localize_script( 'acc-calculator', 'accData', [
			'costRates' => $settings['cost_rates'],
			'feeRates'  => $settings['fee_rates'],
			'showFees'  => $settings['display']['show_fees'],
			'currency'  => $settings['display']['currency'],
			'ctaLabel'  => $settings['display']['cta_label'],
			'ctaUrl'    => $settings['display']['cta_url'],
		] );

		ob_start();
		?>
		<div class="acc-calculator">

			<h2 class="acc-heading"><?php echo esc_html( $settings['display']['heading'] ); ?></h2>

			<div class="acc-form">

				<div class="acc-field">
					<label class="acc-label" for="acc-project-type">
						<?php esc_html_e( 'Project type', 'architecture-cost-calculator' ); ?>
					</label>
					<select class="acc-select" id="acc-project-type">
						<option value=""><?php esc_html_e( '— Select project type —', 'architecture-cost-calculator' ); ?></option>
						<?php foreach ( $project_types as $key => $label ) : ?>
							<option value="<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></option>
						<?php endforeach; ?>
					</select>
				</div>

				<div class="acc-field">
					<label class="acc-label" for="acc-floor-area">
						<?php esc_html_e( 'Approximate floor area (sqm)', 'architecture-cost-calculator' ); ?>
					</label>
					<input
						class="acc-input"
						type="number"
						id="acc-floor-area"
						min="10"
						max="1000"
						step="1"
						placeholder="<?php esc_attr_e( 'e.g. 40', 'architecture-cost-calculator' ); ?>"
					/>
				</div>

				<div class="acc-field">
					<label class="acc-label" for="acc-spec-level">
						<?php esc_html_e( 'Specification level', 'architecture-cost-calculator' ); ?>
					</label>
					<select class="acc-select" id="acc-spec-level">
						<?php foreach ( $spec_levels as $key => $label ) : ?>
							<option value="<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></option>
						<?php endforeach; ?>
					</select>
				</div>

			</div><!-- .acc-form -->

			<div class="acc-results" id="acc-results" aria-live="polite" hidden>
				<div class="acc-results-inner">

					<div class="acc-result-block">
						<h3 class="acc-result-title">
							<?php esc_html_e( 'Estimated build cost', 'architecture-cost-calculator' ); ?>
						</h3>
						<p class="acc-result-value" id="acc-build-cost"></p>
					</div>

					<div class="acc-result-block acc-fees-block" id="acc-fees-block" hidden>
						<h3 class="acc-result-title">
							<?php esc_html_e( 'Estimated architect fees', 'architecture-cost-calculator' ); ?>
						</h3>
						<p class="acc-result-value" id="acc-fees"></p>
					</div>

					<p class="acc-disclaimer">
						<?php esc_html_e( 'These figures are indicative only. Costs vary by location, site conditions, and specification. Contact us for a proper assessment.', 'architecture-cost-calculator' ); ?>
					</p>

					<div class="acc-cta-wrap" id="acc-cta-wrap"></div>

				</div><!-- .acc-results-inner -->
			</div><!-- .acc-results -->

		</div><!-- .acc-calculator -->
		<?php
		return ob_get_clean();
	}
}

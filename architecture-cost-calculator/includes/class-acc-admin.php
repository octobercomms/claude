<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ACC_Admin {

	public function __construct() {
		add_action( 'admin_menu',            [ $this, 'add_menu_page' ] );
		add_action( 'admin_init',            [ $this, 'register_settings' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
	}

	public function add_menu_page(): void {
		add_options_page(
			'Cost Calculator Settings',
			'Cost Calculator',
			'manage_options',
			'acc-settings',
			[ $this, 'render_settings_page' ]
		);
	}

	public function register_settings(): void {
		register_setting(
			'acc_settings_group',
			'acc_settings',
			[ 'sanitize_callback' => [ $this, 'sanitize_settings' ] ]
		);
	}

	public function sanitize_settings( mixed $input ): array {
		if ( ! is_array( $input ) ) {
			return ACC_Calculator::get_defaults();
		}

		$clean         = ACC_Calculator::get_defaults();
		$project_types = array_keys( ACC_Calculator::get_project_types() );
		$spec_levels   = array_keys( ACC_Calculator::get_spec_levels() );

		foreach ( $project_types as $type ) {
			foreach ( $spec_levels as $spec ) {
				if ( isset( $input['cost_rates'][ $type ][ $spec ] ) ) {
					$clean['cost_rates'][ $type ][ $spec ] = max( 0, floatval( $input['cost_rates'][ $type ][ $spec ] ) );
				}
			}
			if ( isset( $input['fee_rates'][ $type ] ) ) {
				$val = floatval( $input['fee_rates'][ $type ] );
				$clean['fee_rates'][ $type ] = max( 0, min( 100, $val ) );
			}
		}

		$clean['display']['cta_label'] = sanitize_text_field( $input['display']['cta_label'] ?? 'Get in touch' );
		$clean['display']['cta_url']   = esc_url_raw( $input['display']['cta_url'] ?? '' );
		$clean['display']['heading']   = sanitize_text_field( $input['display']['heading'] ?? 'Estimate your project cost' );
		$clean['display']['show_fees'] = isset( $input['display']['show_fees'] ) ? '1' : '0';
		$clean['display']['currency']  = sanitize_text_field( $input['display']['currency'] ?? '£' );

		return $clean;
	}

	public function enqueue_assets( string $hook ): void {
		if ( 'settings_page_acc-settings' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'acc-admin', ACC_PLUGIN_URL . 'assets/admin/acc-admin.css', [], ACC_VERSION );
	}

	public function render_settings_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings      = ACC_Calculator::get_settings();
		$project_types = ACC_Calculator::get_project_types();
		$spec_levels   = ACC_Calculator::get_spec_levels();
		$active_tab    = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'cost_rates';
		$valid_tabs    = [ 'cost_rates', 'fee_rates', 'display' ];

		if ( ! in_array( $active_tab, $valid_tabs, true ) ) {
			$active_tab = 'cost_rates';
		}
		?>
		<div class="wrap acc-admin-wrap">
			<h1><?php esc_html_e( 'Cost Calculator Settings', 'architecture-cost-calculator' ); ?></h1>

			<nav class="nav-tab-wrapper" aria-label="Settings tabs">
				<a href="<?php echo esc_url( admin_url( 'options-general.php?page=acc-settings&tab=cost_rates' ) ); ?>"
				   class="nav-tab <?php echo $active_tab === 'cost_rates' ? 'nav-tab-active' : ''; ?>">
					<?php esc_html_e( 'Cost Rates', 'architecture-cost-calculator' ); ?>
				</a>
				<a href="<?php echo esc_url( admin_url( 'options-general.php?page=acc-settings&tab=fee_rates' ) ); ?>"
				   class="nav-tab <?php echo $active_tab === 'fee_rates' ? 'nav-tab-active' : ''; ?>">
					<?php esc_html_e( 'Architect Fee Rates', 'architecture-cost-calculator' ); ?>
				</a>
				<a href="<?php echo esc_url( admin_url( 'options-general.php?page=acc-settings&tab=display' ) ); ?>"
				   class="nav-tab <?php echo $active_tab === 'display' ? 'nav-tab-active' : ''; ?>">
					<?php esc_html_e( 'Display Settings', 'architecture-cost-calculator' ); ?>
				</a>
			</nav>

			<form method="post" action="options.php">
				<?php settings_fields( 'acc_settings_group' ); ?>

				<?php if ( 'cost_rates' === $active_tab ) : ?>
					<div class="acc-tab-content">
						<h2><?php esc_html_e( 'Construction Cost Rates (£ per sqm)', 'architecture-cost-calculator' ); ?></h2>
						<p class="description"><?php esc_html_e( 'Set the build cost per square metre for each project type and specification level.', 'architecture-cost-calculator' ); ?></p>

						<table class="acc-rates-table widefat striped">
							<thead>
								<tr>
									<th><?php esc_html_e( 'Project Type', 'architecture-cost-calculator' ); ?></th>
									<?php foreach ( $spec_levels as $spec_label ) : ?>
										<th><?php echo esc_html( $spec_label ); ?></th>
									<?php endforeach; ?>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $project_types as $type_key => $type_label ) : ?>
									<tr>
										<td><?php echo esc_html( $type_label ); ?></td>
										<?php foreach ( $spec_levels as $spec_key => $spec_label ) : ?>
											<td>
												<span class="acc-currency-symbol">£</span>
												<input
													type="number"
													name="acc_settings[cost_rates][<?php echo esc_attr( $type_key ); ?>][<?php echo esc_attr( $spec_key ); ?>]"
													value="<?php echo esc_attr( $settings['cost_rates'][ $type_key ][ $spec_key ] ?? '' ); ?>"
													min="0"
													step="1"
													class="acc-rate-input"
												/>
											</td>
										<?php endforeach; ?>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>

				<?php elseif ( 'fee_rates' === $active_tab ) : ?>
					<div class="acc-tab-content">
						<h2><?php esc_html_e( 'Architect Fee Rates', 'architecture-cost-calculator' ); ?></h2>
						<p class="description"><?php esc_html_e( 'Set the architect fee as a percentage of mid-point build cost. Typical range: 10–15%.', 'architecture-cost-calculator' ); ?></p>

						<table class="acc-rates-table widefat striped">
							<thead>
								<tr>
									<th><?php esc_html_e( 'Project Type', 'architecture-cost-calculator' ); ?></th>
									<th><?php esc_html_e( 'Fee (%)', 'architecture-cost-calculator' ); ?></th>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $project_types as $type_key => $type_label ) : ?>
									<tr>
										<td><?php echo esc_html( $type_label ); ?></td>
										<td>
											<input
												type="number"
												name="acc_settings[fee_rates][<?php echo esc_attr( $type_key ); ?>]"
												value="<?php echo esc_attr( $settings['fee_rates'][ $type_key ] ?? 12 ); ?>"
												min="0"
												max="100"
												step="0.1"
												class="acc-rate-input acc-rate-input--narrow"
											/>
											<span>%</span>
										</td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>

				<?php elseif ( 'display' === $active_tab ) : ?>
					<div class="acc-tab-content">
						<h2><?php esc_html_e( 'Display Settings', 'architecture-cost-calculator' ); ?></h2>

						<table class="form-table" role="presentation">
							<tr>
								<th scope="row">
									<label for="acc-heading"><?php esc_html_e( 'Calculator Heading', 'architecture-cost-calculator' ); ?></label>
								</th>
								<td>
									<input
										type="text"
										id="acc-heading"
										name="acc_settings[display][heading]"
										value="<?php echo esc_attr( $settings['display']['heading'] ); ?>"
										class="regular-text"
									/>
								</td>
							</tr>
							<tr>
								<th scope="row">
									<label for="acc-cta-label"><?php esc_html_e( 'CTA Button Label', 'architecture-cost-calculator' ); ?></label>
								</th>
								<td>
									<input
										type="text"
										id="acc-cta-label"
										name="acc_settings[display][cta_label]"
										value="<?php echo esc_attr( $settings['display']['cta_label'] ); ?>"
										class="regular-text"
									/>
								</td>
							</tr>
							<tr>
								<th scope="row">
									<label for="acc-cta-url"><?php esc_html_e( 'CTA Button URL', 'architecture-cost-calculator' ); ?></label>
								</th>
								<td>
									<input
										type="url"
										id="acc-cta-url"
										name="acc_settings[display][cta_url]"
										value="<?php echo esc_attr( $settings['display']['cta_url'] ); ?>"
										class="regular-text"
										placeholder="https://"
									/>
									<p class="description"><?php esc_html_e( 'Leave blank to hide the CTA button.', 'architecture-cost-calculator' ); ?></p>
								</td>
							</tr>
							<tr>
								<th scope="row">
									<label for="acc-currency"><?php esc_html_e( 'Currency Symbol', 'architecture-cost-calculator' ); ?></label>
								</th>
								<td>
									<input
										type="text"
										id="acc-currency"
										name="acc_settings[display][currency]"
										value="<?php echo esc_attr( $settings['display']['currency'] ); ?>"
										class="small-text"
										maxlength="3"
									/>
								</td>
							</tr>
							<tr>
								<th scope="row"><?php esc_html_e( 'Show Architect Fees', 'architecture-cost-calculator' ); ?></th>
								<td>
									<label>
										<input
											type="checkbox"
											name="acc_settings[display][show_fees]"
											value="1"
											<?php checked( $settings['display']['show_fees'], '1' ); ?>
										/>
										<?php esc_html_e( 'Display the architect fees estimate section', 'architecture-cost-calculator' ); ?>
									</label>
								</td>
							</tr>
						</table>
					</div>
				<?php endif; ?>

				<?php submit_button(); ?>
			</form>

			<div class="acc-usage-info">
				<h3><?php esc_html_e( 'Shortcode', 'architecture-cost-calculator' ); ?></h3>
				<p><?php esc_html_e( 'Embed the calculator on any page or post:', 'architecture-cost-calculator' ); ?></p>
				<code>[arch_cost_calculator]</code>
			</div>
		</div>
		<?php
	}
}

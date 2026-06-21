<?php
/**
 * The central "Lead Times" screen under the WooCommerce menu.
 *
 * Tabbed for clarity:
 *   - Suppliers          — per-supplier lead times.
 *   - Defaults & display — global fallback, seasonal default, stock label.
 *   - Products           — per-product overrides, with category bulk-apply.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Admin {

	const PAGE = 'ac-lead-times';

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
		add_action( 'admin_post_aclt_save', [ $this, 'handle_save' ] );
		add_action( 'admin_post_aclt_save_overrides', [ $this, 'handle_save_overrides' ] );
		add_action( 'admin_post_aclt_apply_category', [ $this, 'handle_apply_category' ] );
		add_action( 'admin_post_aclt_export_csv', [ $this, 'handle_export_csv' ] );
		add_action( 'admin_post_aclt_import_csv', [ $this, 'handle_import_csv' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue' ] );
	}

	public function register_menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Lead Times', 'anothercountry-lead-times' ),
			__( 'Lead Times', 'anothercountry-lead-times' ),
			'manage_woocommerce',
			self::PAGE,
			[ $this, 'render_page' ]
		);
	}

	public function enqueue( string $hook ): void {
		if ( 'woocommerce_page_' . self::PAGE !== $hook ) {
			return;
		}
		wp_enqueue_style( 'aclt-admin', ACLT_URL . 'assets/css/admin.css', [], ACLT_VERSION );
	}

	/** Which tab is active. */
	private function current_tab(): string {
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'suppliers'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return in_array( $tab, [ 'suppliers', 'defaults', 'products' ], true ) ? $tab : 'suppliers';
	}

	private function tab_url( string $tab ): string {
		return add_query_arg( [ 'page' => self::PAGE, 'tab' => $tab ], admin_url( 'admin.php' ) );
	}

	public function render_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'anothercountry-lead-times' ) );
		}
		$tab = $this->current_tab();
		?>
		<div class="wrap aclt-wrap">
			<h1><?php esc_html_e( 'Another Country — Lead Times', 'anothercountry-lead-times' ); ?></h1>

			<?php if ( isset( $_GET['imported'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php echo esc_html( sprintf( __( 'Imported %d products from CSV.', 'anothercountry-lead-times' ), absint( $_GET['imported'] ) ) ); ?></p></div>
			<?php elseif ( isset( $_GET['import_error'] ) ) : ?>
				<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'Import failed — the CSV needs a “Product ID” column and an “Override” column (re-upload a file exported from here).', 'anothercountry-lead-times' ); ?></p></div>
			<?php elseif ( isset( $_GET['updated'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Saved.', 'anothercountry-lead-times' ); ?></p></div>
			<?php endif; ?>

			<h2 class="nav-tab-wrapper">
				<a href="<?php echo esc_url( $this->tab_url( 'suppliers' ) ); ?>" class="nav-tab <?php echo 'suppliers' === $tab ? 'nav-tab-active' : ''; ?>"><?php esc_html_e( 'Suppliers', 'anothercountry-lead-times' ); ?></a>
				<a href="<?php echo esc_url( $this->tab_url( 'defaults' ) ); ?>" class="nav-tab <?php echo 'defaults' === $tab ? 'nav-tab-active' : ''; ?>"><?php esc_html_e( 'Defaults & display', 'anothercountry-lead-times' ); ?></a>
				<a href="<?php echo esc_url( $this->tab_url( 'products' ) ); ?>" class="nav-tab <?php echo 'products' === $tab ? 'nav-tab-active' : ''; ?>"><?php esc_html_e( 'Products', 'anothercountry-lead-times' ); ?></a>
			</h2>

			<?php
			if ( 'products' === $tab ) {
				$this->render_products_panel();
			} else {
				$this->render_settings_form( $tab );
			}
			?>
		</div>
		<?php
	}

	/**
	 * The Suppliers + Defaults form (both panels live in one form so a single
	 * save persists everything; only the active tab's panel is shown).
	 */
	private function render_settings_form( string $tab ): void {
		$settings         = aclt_get_settings();
		$terms            = get_terms( [ 'taxonomy' => ACLT_TAX, 'hide_empty' => false, 'orderby' => 'name' ] );
		$terms            = is_wp_error( $terms ) ? [] : $terms;
		$add_supplier_url = admin_url( 'edit-tags.php?taxonomy=' . ACLT_TAX . '&post_type=product' );
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="aclt_save" />
			<input type="hidden" name="aclt_active_tab" value="<?php echo esc_attr( $tab ); ?>" />
			<?php wp_nonce_field( 'aclt_save', 'aclt_save_nonce' ); ?>

			<!-- Suppliers panel -->
			<div class="aclt-panel" <?php echo 'suppliers' === $tab ? '' : 'style="display:none"'; ?>>
				<p class="aclt-intro">
					<?php esc_html_e( 'Set each supplier’s lead time once — every product attached to that supplier updates automatically.', 'anothercountry-lead-times' ); ?>
					<a class="button" href="<?php echo esc_url( $add_supplier_url ); ?>"><?php esc_html_e( '+ Add / manage suppliers', 'anothercountry-lead-times' ); ?></a>
				</p>

				<?php if ( empty( $terms ) ) : ?>
					<p><?php esc_html_e( 'No suppliers yet.', 'anothercountry-lead-times' ); ?>
						<a href="<?php echo esc_url( $add_supplier_url ); ?>"><?php esc_html_e( 'Add your first supplier', 'anothercountry-lead-times' ); ?></a>.</p>
				<?php else : ?>
					<table class="widefat striped aclt-table">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Supplier', 'anothercountry-lead-times' ); ?></th>
								<th><?php esc_html_e( 'Show', 'anothercountry-lead-times' ); ?></th>
								<th><?php esc_html_e( 'Base lead time', 'anothercountry-lead-times' ); ?></th>
								<th><?php esc_html_e( 'Out-of-stock', 'anothercountry-lead-times' ); ?></th>
								<th><?php esc_html_e( 'Extra note', 'anothercountry-lead-times' ); ?></th>
								<th><?php esc_html_e( 'Seasonal (on / from / to / note)', 'anothercountry-lead-times' ); ?></th>
							</tr>
						</thead>
						<tbody>
						<?php foreach ( $terms as $term ) :
							$d      = ACLT_Taxonomy::get_data( $term->term_id );
							$active = ! empty( $d['season_enabled'] ) && ACLT_Resolver::in_season( $d['season_start'], $d['season_end'] );
							$base   = "s[{$term->term_id}]";
							?>
							<tr>
								<td class="aclt-supplier">
									<strong><?php echo esc_html( $term->name ); ?></strong>
									<span class="aclt-count"><?php echo esc_html( sprintf( _n( '%d product', '%d products', $term->count, 'anothercountry-lead-times' ), $term->count ) ); ?></span>
								</td>
								<td><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[enabled]" value="1" <?php checked( $d['enabled'], 1 ); ?> /></td>
								<td><input type="text" class="regular-text" name="<?php echo esc_attr( $base ); ?>[base]" value="<?php echo esc_attr( $d['base'] ); ?>" placeholder="9–12 weeks" /></td>
								<td><input type="text" name="<?php echo esc_attr( $base ); ?>[oos]" value="<?php echo esc_attr( $d['oos'] ); ?>" placeholder="12–15 weeks" /></td>
								<td><input type="text" name="<?php echo esc_attr( $base ); ?>[note]" value="<?php echo esc_attr( $d['note'] ); ?>" placeholder="from receipt of fabric…" /></td>
								<td class="aclt-season <?php echo $active ? 'aclt-season-active' : ''; ?>">
									<label class="aclt-season-toggle"><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[season_enabled]" value="1" <?php checked( $d['season_enabled'], 1 ); ?> /> <?php esc_html_e( 'On', 'anothercountry-lead-times' ); ?></label>
									<input type="text" size="6" name="<?php echo esc_attr( $base ); ?>[season_start]" value="<?php echo esc_attr( $d['season_start'] ); ?>" placeholder="07-01" />
									<input type="text" size="6" name="<?php echo esc_attr( $base ); ?>[season_end]" value="<?php echo esc_attr( $d['season_end'] ); ?>" placeholder="09-30" />
									<input type="text" name="<?php echo esc_attr( $base ); ?>[season_note]" value="<?php echo esc_attr( $d['season_note'] ); ?>" placeholder="Allow an extra 3–4 weeks…" />
									<?php
									if ( empty( $d['season_enabled'] ) ) {
										echo '<span class="aclt-status aclt-status-off">' . esc_html__( 'Off', 'anothercountry-lead-times' ) . '</span>';
									} elseif ( $active ) {
										echo '<span class="aclt-status aclt-status-active">' . esc_html__( 'Active now', 'anothercountry-lead-times' ) . '</span>';
									} else {
										echo '<span class="aclt-status aclt-status-scheduled">' . esc_html__( 'Scheduled', 'anothercountry-lead-times' ) . '</span>';
									}
									?>
								</td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>
			</div>

			<!-- Defaults & display panel -->
			<div class="aclt-panel" <?php echo 'defaults' === $tab ? '' : 'style="display:none"'; ?>>
				<h2><?php esc_html_e( 'Global defaults', 'anothercountry-lead-times' ); ?></h2>
				<p class="description"><?php esc_html_e( 'The bottom-layer fallback, used when a product has no per-product lead time and no configured supplier. Seeded to match the current site wording.', 'anothercountry-lead-times' ); ?></p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="aclt_default_lead"><?php esc_html_e( 'Default lead time', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_default_lead" class="regular-text" name="settings[default_lead]" value="<?php echo esc_attr( $settings['default_lead'] ); ?>" placeholder="8-10 weeks" /></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Default seasonal note', 'anothercountry-lead-times' ); ?></th>
						<td>
							<?php
							$def_on     = ! empty( $settings['default_season_enabled'] );
							$def_active = $def_on && ACLT_Resolver::in_season( $settings['default_season_start'], $settings['default_season_end'] );
							if ( ! $def_on ) {
								echo '<span class="aclt-status aclt-status-off">' . esc_html__( 'Off', 'anothercountry-lead-times' ) . '</span> ';
							} elseif ( $def_active ) {
								echo '<span class="aclt-status aclt-status-active">' . esc_html__( 'Active now', 'anothercountry-lead-times' ) . '</span> ';
							} else {
								echo '<span class="aclt-status aclt-status-scheduled">' . esc_html__( 'Scheduled — not showing today', 'anothercountry-lead-times' ) . '</span> ';
							}
							?>
							<br />
							<label><input type="checkbox" name="settings[default_season_enabled]" value="1" <?php checked( $settings['default_season_enabled'], 1 ); ?> /> <?php esc_html_e( 'Enable', 'anothercountry-lead-times' ); ?></label>
							&nbsp; <?php esc_html_e( 'From', 'anothercountry-lead-times' ); ?>
							<input type="text" size="6" name="settings[default_season_start]" value="<?php echo esc_attr( $settings['default_season_start'] ); ?>" placeholder="07-01" />
							<?php esc_html_e( 'to', 'anothercountry-lead-times' ); ?>
							<input type="text" size="6" name="settings[default_season_end]" value="<?php echo esc_attr( $settings['default_season_end'] ); ?>" placeholder="09-30" />
							<br />
							<input type="text" class="large-text" name="settings[default_season_note]" value="<?php echo esc_attr( $settings['default_season_note'] ); ?>" placeholder="Allow up to 15 weeks for orders placed July to September." />
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Stock label', 'anothercountry-lead-times' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Relabels WooCommerce stock statuses near the price (replaces the Woo Custom Stock Status plugin).', 'anothercountry-lead-times' ); ?></p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Relabel stock statuses', 'anothercountry-lead-times' ); ?></th>
						<td><label><input type="checkbox" name="settings[relabel_stock]" value="1" <?php checked( $settings['relabel_stock'], 1 ); ?> /> <?php esc_html_e( 'Enabled', 'anothercountry-lead-times' ); ?></label></td>
					</tr>
					<tr>
						<th scope="row"><label for="aclt_label_backorder"><?php esc_html_e( '“On backorder” label', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_label_backorder" name="settings[label_backorder]" value="<?php echo esc_attr( $settings['label_backorder'] ); ?>" placeholder="Made to Order" />
							&nbsp;<input type="text" size="9" name="settings[label_color]" value="<?php echo esc_attr( $settings['label_color'] ); ?>" placeholder="#77a464" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="aclt_label_outofstock"><?php esc_html_e( '“Out of stock” label', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_label_outofstock" name="settings[label_outofstock]" value="<?php echo esc_attr( $settings['label_outofstock'] ); ?>" placeholder="Out of Stock" />
							&nbsp;<input type="text" size="9" name="settings[label_color_oos]" value="<?php echo esc_attr( $settings['label_color_oos'] ); ?>" placeholder="#ff0000" /></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Standalone notice (optional)', 'anothercountry-lead-times' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Auto-display', 'anothercountry-lead-times' ); ?></th>
						<td><label><input type="checkbox" name="settings[auto_display]" value="1" <?php checked( $settings['auto_display'], 1 ); ?> />
							<?php esc_html_e( 'Show the plugin’s own notice on single product pages.', 'anothercountry-lead-times' ); ?></label>
							<p class="description"><?php echo wp_kses_post( __( 'Leave off when the theme renders the lead time (the normal setup). The <code>[ac_lead_time]</code> shortcode works regardless.', 'anothercountry-lead-times' ) ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="aclt_prefix"><?php esc_html_e( 'Notice label', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_prefix" class="regular-text" name="settings[prefix]" value="<?php echo esc_attr( $settings['prefix'] ); ?>" /></td>
					</tr>
				</table>
			</div>

			<?php submit_button( __( 'Save changes', 'anothercountry-lead-times' ) ); ?>
		</form>
		<?php
	}

	/**
	 * Products tab: category bulk-apply + searchable, paginated override list.
	 */
	private function render_products_panel(): void {
		$search  = isset( $_GET['aclt_s'] ) ? sanitize_text_field( wp_unslash( $_GET['aclt_s'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$cat     = isset( $_GET['aclt_cat'] ) ? absint( $_GET['aclt_cat'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$paged   = isset( $_GET['aclt_p'] ) ? max( 1, absint( $_GET['aclt_p'] ) ) : 1; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$pp_in   = isset( $_GET['aclt_pp'] ) ? sanitize_text_field( wp_unslash( $_GET['aclt_pp'] ) ) : '50'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$per_page = 'all' === $pp_in ? -1 : max( 1, absint( $pp_in ) );

		$cat_term = $cat ? get_term( $cat, 'product_cat' ) : null;
		$cat_name = ( $cat_term && ! is_wp_error( $cat_term ) ) ? $cat_term->name : '';

		// --- Category chips ("tag cloud") ---
		$cats = get_terms( [ 'taxonomy' => 'product_cat', 'hide_empty' => true, 'orderby' => 'name' ] );
		$cats = is_wp_error( $cats ) ? [] : $cats;
		?>
		<p class="description" style="margin-top:1em"><?php esc_html_e( 'Override the lead time for individual products, or apply one message to a whole category at once. Leave a field blank to inherit from the supplier / global default.', 'anothercountry-lead-times' ); ?></p>

		<div class="aclt-io">
			<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=aclt_export_csv' ), 'aclt_export' ) ); ?>">⬇ <?php esc_html_e( 'Export CSV', 'anothercountry-lead-times' ); ?></a>
			<span class="description"><?php esc_html_e( 'Download every product + its lead time. Send to the team to fill in the “Override” column, then import it back.', 'anothercountry-lead-times' ); ?></span>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" class="aclt-import-form">
				<input type="hidden" name="action" value="aclt_import_csv" />
				<?php wp_nonce_field( 'aclt_import', 'aclt_import_nonce' ); ?>
				<input type="file" name="aclt_csv" accept=".csv" required />
				<?php submit_button( __( 'Import CSV', 'anothercountry-lead-times' ), 'secondary', 'submit', false ); ?>
				<span class="description"><?php esc_html_e( 'Updates the Override for each row by Product ID. Blank Override = inherit.', 'anothercountry-lead-times' ); ?></span>
			</form>
		</div>

		<div class="aclt-catcloud">
			<a class="aclt-chip <?php echo 0 === $cat ? 'is-active' : ''; ?>" href="<?php echo esc_url( $this->tab_url( 'products' ) ); ?>"><?php esc_html_e( 'All', 'anothercountry-lead-times' ); ?></a>
			<?php foreach ( $cats as $c ) :
				$url = add_query_arg( [ 'page' => self::PAGE, 'tab' => 'products', 'aclt_cat' => $c->term_id ], admin_url( 'admin.php' ) );
				?>
				<a class="aclt-chip <?php echo $cat === $c->term_id ? 'is-active' : ''; ?>" href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $c->name ); ?> <span class="aclt-chip-count"><?php echo (int) $c->count; ?></span></a>
			<?php endforeach; ?>
		</div>

		<?php if ( $cat && $cat_name ) : ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="aclt-bulk-apply" onsubmit="return confirm('<?php echo esc_js( sprintf( __( 'Apply this lead time to every product in “%s”? This overrides each product individually.', 'anothercountry-lead-times' ), $cat_name ) ); ?>');">
				<input type="hidden" name="action" value="aclt_apply_category" />
				<input type="hidden" name="aclt_cat" value="<?php echo esc_attr( $cat ); ?>" />
				<?php wp_nonce_field( 'aclt_apply_category', 'aclt_apply_nonce' ); ?>
				<strong><?php echo esc_html( sprintf( __( 'Apply to all in “%s”:', 'anothercountry-lead-times' ), $cat_name ) ); ?></strong>
				<input type="text" name="aclt_apply_value" placeholder="<?php esc_attr_e( 'e.g. 10-12 weeks (blank = clear overrides)', 'anothercountry-lead-times' ); ?>" style="width:22em" />
				<?php submit_button( __( 'Apply to category', 'anothercountry-lead-times' ), 'secondary', 'submit', false ); ?>
			</form>
		<?php endif; ?>

		<!-- Search + per-page -->
		<form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" class="aclt-products-filter">
			<input type="hidden" name="page" value="<?php echo esc_attr( self::PAGE ); ?>" />
			<input type="hidden" name="tab" value="products" />
			<?php if ( $cat ) : ?><input type="hidden" name="aclt_cat" value="<?php echo esc_attr( $cat ); ?>" /><?php endif; ?>
			<input type="search" name="aclt_s" value="<?php echo esc_attr( $search ); ?>" placeholder="<?php esc_attr_e( 'Search products…', 'anothercountry-lead-times' ); ?>" />
			<select name="aclt_pp">
				<?php foreach ( [ '50', '100', '200', 'all' ] as $opt ) : ?>
					<option value="<?php echo esc_attr( $opt ); ?>" <?php selected( $pp_in, $opt ); ?>><?php echo 'all' === $opt ? esc_html__( 'Show all', 'anothercountry-lead-times' ) : esc_html( $opt . ' / page' ); ?></option>
				<?php endforeach; ?>
			</select>
			<button class="button"><?php esc_html_e( 'Filter', 'anothercountry-lead-times' ); ?></button>
		</form>
		<?php if ( 'all' === $pp_in ) : ?>
			<p class="description"><?php esc_html_e( '“Show all” can be slow on stores with many products. For big batches, use the category apply above.', 'anothercountry-lead-times' ); ?></p>
		<?php endif; ?>

		<?php
		$args = [
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => $per_page,
			'paged'          => $paged,
			'orderby'        => 'title',
			'order'          => 'ASC',
		];
		if ( '' !== $search ) {
			$args['s'] = $search;
		}
		if ( $cat ) {
			$args['tax_query'] = [ [ 'taxonomy' => 'product_cat', 'field' => 'term_id', 'terms' => [ $cat ] ] ];
		}
		$query = new WP_Query( $args );
		?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="aclt_save_overrides" />
			<input type="hidden" name="aclt_return_s" value="<?php echo esc_attr( $search ); ?>" />
			<input type="hidden" name="aclt_return_cat" value="<?php echo esc_attr( $cat ); ?>" />
			<input type="hidden" name="aclt_return_pp" value="<?php echo esc_attr( $pp_in ); ?>" />
			<input type="hidden" name="aclt_return_p" value="<?php echo esc_attr( $paged ); ?>" />
			<?php wp_nonce_field( 'aclt_overrides', 'aclt_overrides_nonce' ); ?>

			<div class="aclt-scroll">
			<table class="widefat striped aclt-products">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Product / variation', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Manage', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Qty', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Stock status', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Backorders', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Lead time', 'anothercountry-lead-times' ); ?></th>
						<th><?php esc_html_e( 'Old message', 'anothercountry-lead-times' ); ?></th>
						<th style="width:12%"><?php esc_html_e( 'Override', 'anothercountry-lead-times' ); ?></th>
					</tr>
				</thead>
				<tbody>
				<?php if ( ! $query->have_posts() ) : ?>
					<tr><td colspan="8"><?php esc_html_e( 'No products found.', 'anothercountry-lead-times' ); ?></td></tr>
				<?php else : foreach ( $query->posts as $post ) :
					$pid      = $post->ID;
					$product  = function_exists( 'wc_get_product' ) ? wc_get_product( $pid ) : null;
					if ( ! $product ) {
						continue;
					}
					$term     = ACLT_Resolver::get_supplier_term( $pid );
					$resolved = ACLT_Resolver::get_lead_time( $pid );
					$override = get_post_meta( $pid, '_ac_lead_time', true );
					$old      = ACLT_Resolver::old_message( $pid );
					$meta     = trim( $product->get_sku() . ( $term ? ' · ' . $term->name : '' ), ' ·' );
					?>
					<tr>
						<td>
							<a href="<?php echo esc_url( get_edit_post_link( $pid ) ); ?>"><strong><?php echo esc_html( get_the_title( $pid ) ); ?></strong></a>
							<?php if ( 'publish' !== $post->post_status ) : ?> <em>(<?php echo esc_html( $post->post_status ); ?>)</em><?php endif; ?>
							<?php if ( $meta ) : ?><br /><span class="aclt-meta"><?php echo esc_html( $meta ); ?></span><?php endif; ?>
						</td>
						<?php $this->inv_cells( $product ); ?>
						<td><?php echo esc_html( $resolved ); ?></td>
						<td class="aclt-old"><?php echo esc_html( $old ); ?></td>
						<td><input type="text" name="ov[<?php echo esc_attr( $pid ); ?>]" value="<?php echo esc_attr( $override ); ?>" placeholder="<?php esc_attr_e( 'inherit', 'anothercountry-lead-times' ); ?>" style="width:100%" /></td>
					</tr>
					<?php
					if ( $product->is_type( 'variable' ) ) :
						foreach ( $product->get_children() as $vid ) :
							$v = wc_get_product( $vid );
							if ( ! $v ) {
								continue;
							}
							$vname = function_exists( 'wc_get_formatted_variation' ) ? wc_get_formatted_variation( $v, true ) : '#' . $vid;
							?>
							<?php $v_override = get_post_meta( $vid, '_ac_lead_time', true ); ?>
							<tr class="aclt-variation-row">
								<td class="aclt-variation-name">↳ <?php echo esc_html( $vname ?: ( '#' . $vid ) ); ?><?php if ( $v->get_sku() ) : ?><br /><span class="aclt-meta"><?php echo esc_html( $v->get_sku() ); ?></span><?php endif; ?></td>
								<?php $this->inv_cells( $v ); ?>
								<td><?php echo esc_html( ACLT_Resolver::get_lead_time( $vid ) ); ?></td>
								<td>—</td>
								<td><input type="text" name="ov[<?php echo esc_attr( $vid ); ?>]" value="<?php echo esc_attr( $v_override ); ?>" placeholder="<?php esc_attr_e( 'inherit', 'anothercountry-lead-times' ); ?>" style="width:100%" /></td>
							</tr>
						<?php endforeach;
					endif;
					?>
				<?php endforeach; endif; ?>
				</tbody>
			</table>
			</div>

			<p class="description"><?php esc_html_e( 'Stock columns are read-only (edit inventory in WooCommerce). Override sets the lead time per product — and per variation if you need a variant to differ. Blank = inherit.', 'anothercountry-lead-times' ); ?></p>

			<?php
			$total_pages = (int) $query->max_num_pages;
			if ( $per_page > 0 && $total_pages > 1 ) {
				$page_link = add_query_arg( array_filter( [ 'page' => self::PAGE, 'tab' => 'products', 'aclt_s' => $search, 'aclt_cat' => $cat, 'aclt_pp' => $pp_in ] ), admin_url( 'admin.php' ) );
				echo '<p class="tablenav-pages" style="margin:1em 0">';
				echo wp_kses_post( paginate_links( [
					'base'      => add_query_arg( 'aclt_p', '%#%', $page_link ),
					'format'    => '',
					'current'   => $paged,
					'total'     => $total_pages,
					'prev_text' => '&larr;',
					'next_text' => '&rarr;',
				] ) );
				echo '</p>';
			}
			?>

			<?php submit_button( __( 'Save changes on this page', 'anothercountry-lead-times' ) ); ?>
		</form>
		<?php
		wp_reset_postdata();
	}

	/** Read-only inventory cells (Manage / Qty / Stock status / Backorders). */
	private function inv_cells( $p ): void {
		$manage    = $p->get_manage_stock();
		$qty       = $p->get_stock_quantity();
		$bo        = $p->get_backorders();
		$backorder = [ 'no' => __( 'No', 'anothercountry-lead-times' ), 'notify' => __( 'Allow, notify', 'anothercountry-lead-times' ), 'yes' => __( 'Allow', 'anothercountry-lead-times' ) ];
		?>
		<td style="text-align:center"><?php echo $manage ? '&#10003;' : '&mdash;'; ?></td>
		<td><?php echo ( $manage && null !== $qty ) ? esc_html( (string) $qty ) : '&mdash;'; ?></td>
		<td><?php echo esc_html( ACLT_Resolver::stock_label( $p->get_id() ) ); ?></td>
		<td><?php echo esc_html( $backorder[ $bo ] ?? $bo ); ?></td>
		<?php
	}

	// -------------------------------------------------------------------------
	// Save handlers
	// -------------------------------------------------------------------------

	public function handle_save(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'anothercountry-lead-times' ) );
		}
		check_admin_referer( 'aclt_save', 'aclt_save_nonce' );

		$suppliers = isset( $_POST['s'] ) && is_array( $_POST['s'] ) ? wp_unslash( $_POST['s'] ) : [];
		foreach ( $suppliers as $term_id => $row ) {
			$term_id = absint( $term_id );
			if ( ! $term_id || ! is_array( $row ) ) {
				continue;
			}
			update_term_meta( $term_id, 'aclt_enabled', empty( $row['enabled'] ) ? 0 : 1 );
			update_term_meta( $term_id, 'aclt_base', sanitize_text_field( $row['base'] ?? '' ) );
			update_term_meta( $term_id, 'aclt_oos', sanitize_text_field( $row['oos'] ?? '' ) );
			update_term_meta( $term_id, 'aclt_note', sanitize_text_field( $row['note'] ?? '' ) );
			update_term_meta( $term_id, 'aclt_season_enabled', empty( $row['season_enabled'] ) ? 0 : 1 );
			update_term_meta( $term_id, 'aclt_season_start', ACLT_Resolver::sanitize_md( $row['season_start'] ?? '' ) );
			update_term_meta( $term_id, 'aclt_season_end', ACLT_Resolver::sanitize_md( $row['season_end'] ?? '' ) );
			update_term_meta( $term_id, 'aclt_season_note', sanitize_text_field( $row['season_note'] ?? '' ) );
		}

		$in       = isset( $_POST['settings'] ) && is_array( $_POST['settings'] ) ? wp_unslash( $_POST['settings'] ) : [];
		$defaults = aclt_default_settings();
		update_option( 'aclt_settings', [
			'auto_display'           => empty( $in['auto_display'] ) ? 0 : 1,
			'prefix'                 => sanitize_text_field( $in['prefix'] ?? '' ),
			'default_lead'           => sanitize_text_field( $in['default_lead'] ?? '' ) ?: $defaults['default_lead'],
			'default_season_enabled' => empty( $in['default_season_enabled'] ) ? 0 : 1,
			'default_season_start'   => ACLT_Resolver::sanitize_md( $in['default_season_start'] ?? '' ),
			'default_season_end'     => ACLT_Resolver::sanitize_md( $in['default_season_end'] ?? '' ),
			'default_season_note'    => sanitize_text_field( $in['default_season_note'] ?? '' ),
			'relabel_stock'          => empty( $in['relabel_stock'] ) ? 0 : 1,
			'label_backorder'        => sanitize_text_field( $in['label_backorder'] ?? '' ),
			'label_outofstock'       => sanitize_text_field( $in['label_outofstock'] ?? '' ),
			'label_color'            => sanitize_hex_color( $in['label_color'] ?? '' ) ?: $defaults['label_color'],
			'label_color_oos'        => sanitize_hex_color( $in['label_color_oos'] ?? '' ) ?: $defaults['label_color_oos'],
		] );

		$tab = isset( $_POST['aclt_active_tab'] ) ? sanitize_key( wp_unslash( $_POST['aclt_active_tab'] ) ) : 'suppliers';
		$this->redirect( [ 'tab' => $tab ] );
	}

	public function handle_save_overrides(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'anothercountry-lead-times' ) );
		}
		check_admin_referer( 'aclt_overrides', 'aclt_overrides_nonce' );

		$rows = isset( $_POST['ov'] ) && is_array( $_POST['ov'] ) ? wp_unslash( $_POST['ov'] ) : [];
		foreach ( $rows as $pid => $value ) {
			$pid = absint( $pid );
			if ( ! $pid || ! current_user_can( 'edit_post', $pid ) ) {
				continue;
			}
			update_post_meta( $pid, '_ac_lead_time', sanitize_text_field( $value ) );
		}

		$this->redirect( [
			'tab'      => 'products',
			'aclt_s'   => isset( $_POST['aclt_return_s'] ) ? sanitize_text_field( wp_unslash( $_POST['aclt_return_s'] ) ) : '',
			'aclt_cat' => isset( $_POST['aclt_return_cat'] ) ? absint( $_POST['aclt_return_cat'] ) : 0,
			'aclt_pp'  => isset( $_POST['aclt_return_pp'] ) ? sanitize_text_field( wp_unslash( $_POST['aclt_return_pp'] ) ) : '50',
			'aclt_p'   => isset( $_POST['aclt_return_p'] ) ? absint( $_POST['aclt_return_p'] ) : 1,
		] );
	}

	/**
	 * Apply one lead-time override to every product in a category.
	 */
	public function handle_apply_category(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'anothercountry-lead-times' ) );
		}
		check_admin_referer( 'aclt_apply_category', 'aclt_apply_nonce' );

		$cat   = isset( $_POST['aclt_cat'] ) ? absint( $_POST['aclt_cat'] ) : 0;
		$value = isset( $_POST['aclt_apply_value'] ) ? sanitize_text_field( wp_unslash( $_POST['aclt_apply_value'] ) ) : '';

		if ( $cat ) {
			$ids = get_posts( [
				'post_type'      => 'product',
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'tax_query'      => [ [ 'taxonomy' => 'product_cat', 'field' => 'term_id', 'terms' => [ $cat ] ] ],
			] );
			foreach ( $ids as $pid ) {
				update_post_meta( $pid, '_ac_lead_time', $value );
			}
		}

		$this->redirect( [ 'tab' => 'products', 'aclt_cat' => $cat ] );
	}

	/**
	 * Export every product + lead time as CSV (round-trips with the importer).
	 */
	public function handle_export_csv(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'anothercountry-lead-times' ) );
		}
		check_admin_referer( 'aclt_export' );

		$ids = get_posts( [
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'title',
			'order'          => 'ASC',
		] );

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=ac-lead-times-' . gmdate( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' );
		fputcsv( $out, [ 'Product ID', 'SKU', 'Product', 'Categories', 'Stock', 'Supplier', 'Lead time', 'Old message', 'Override' ] );
		foreach ( $ids as $pid ) {
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( $pid ) : null;
			$cats    = wp_get_post_terms( $pid, 'product_cat', [ 'fields' => 'names' ] );
			$term    = ACLT_Resolver::get_supplier_term( $pid );
			fputcsv( $out, [
				$pid,
				$product ? $product->get_sku() : '',
				get_the_title( $pid ),
				is_wp_error( $cats ) ? '' : implode( ', ', $cats ),
				ACLT_Resolver::stock_label( $pid ),
				$term ? $term->name : '',
				ACLT_Resolver::get_lead_time( $pid ),
				ACLT_Resolver::old_message( $pid ),
				(string) get_post_meta( $pid, '_ac_lead_time', true ),
			] );
		}
		fclose( $out );
		exit;
	}

	/**
	 * Import a CSV and update each product's override by Product ID.
	 */
	public function handle_import_csv(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'anothercountry-lead-times' ) );
		}
		check_admin_referer( 'aclt_import', 'aclt_import_nonce' );

		if ( empty( $_FILES['aclt_csv']['tmp_name'] ) || ! is_uploaded_file( $_FILES['aclt_csv']['tmp_name'] ) ) {
			$this->redirect( [ 'tab' => 'products', 'import_error' => 1 ] );
		}

		$fh = fopen( $_FILES['aclt_csv']['tmp_name'], 'r' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( ! $fh ) {
			$this->redirect( [ 'tab' => 'products', 'import_error' => 1 ] );
		}

		$header = fgetcsv( $fh );
		$idx_id = $idx_ov = null;
		if ( is_array( $header ) ) {
			foreach ( $header as $i => $col ) {
				$col = strtolower( trim( (string) $col ) );
				if ( 'product id' === $col || 'id' === $col ) {
					$idx_id = $i;
				} elseif ( false !== strpos( $col, 'override' ) ) {
					$idx_ov = $i;
				}
			}
		}

		if ( null === $idx_id || null === $idx_ov ) {
			fclose( $fh );
			$this->redirect( [ 'tab' => 'products', 'import_error' => 1 ] );
		}

		$updated = 0;
		while ( ( $row = fgetcsv( $fh ) ) !== false ) {
			$pid = absint( $row[ $idx_id ] ?? 0 );
			if ( ! $pid || 'product' !== get_post_type( $pid ) || ! current_user_can( 'edit_post', $pid ) ) {
				continue;
			}
			update_post_meta( $pid, '_ac_lead_time', sanitize_text_field( $row[ $idx_ov ] ?? '' ) );
			$updated++;
		}
		fclose( $fh );

		$this->redirect( [ 'tab' => 'products', 'imported' => $updated ] );
	}

	/** Redirect back to the page with the given args + an updated flag. */
	private function redirect( array $args ): void {
		$args = array_merge( [ 'page' => self::PAGE, 'updated' => 1 ], $args );
		// Drop empty / zero values so the URL stays clean (page is always kept).
		$args = array_filter( $args, static function ( $v, $k ) {
			return 'page' === $k || ( '' !== $v && null !== $v && 0 !== $v );
		}, ARRAY_FILTER_USE_BOTH );
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}

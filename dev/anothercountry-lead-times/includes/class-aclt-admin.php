<?php
/**
 * The central "Lead Times" screen under the WooCommerce menu.
 *
 * One page to review and update every supplier's lead time at once — the single
 * point of control. Supplier creation still happens on the Products → Suppliers
 * taxonomy screen; this page is for fast day-to-day editing of the lead times.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Admin {

	const PAGE = 'ac-lead-times';

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
		add_action( 'admin_post_aclt_save', [ $this, 'handle_save' ] );
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

	public function render_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'anothercountry-lead-times' ) );
		}

		$settings = aclt_get_settings();
		$terms    = get_terms( [
			'taxonomy'   => ACLT_TAX,
			'hide_empty' => false,
			'orderby'    => 'name',
		] );
		if ( is_wp_error( $terms ) ) {
			$terms = [];
		}

		$add_supplier_url = admin_url( 'edit-tags.php?taxonomy=' . ACLT_TAX . '&post_type=product' );
		?>
		<div class="wrap aclt-wrap">
			<h1><?php esc_html_e( 'Another Country — Lead Times', 'anothercountry-lead-times' ); ?></h1>
			<p class="aclt-intro">
				<?php esc_html_e( 'Update the delivery lead time for each supplier in one place. Every product attached to a supplier shows that supplier’s lead time automatically.', 'anothercountry-lead-times' ); ?>
				<a class="button" href="<?php echo esc_url( $add_supplier_url ); ?>"><?php esc_html_e( '+ Add / manage suppliers', 'anothercountry-lead-times' ); ?></a>
			</p>

			<?php if ( isset( $_GET['updated'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Lead times saved.', 'anothercountry-lead-times' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="aclt_save" />
				<?php wp_nonce_field( 'aclt_save', 'aclt_save_nonce' ); ?>

				<h2><?php esc_html_e( 'Suppliers', 'anothercountry-lead-times' ); ?></h2>

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
								<th><?php esc_html_e( 'Seasonal (from / to / text)', 'anothercountry-lead-times' ); ?></th>
							</tr>
						</thead>
						<tbody>
						<?php foreach ( $terms as $term ) :
							$d        = ACLT_Taxonomy::get_data( $term->term_id );
							$active   = ! empty( $d['season_enabled'] ) && ACLT_Resolver::in_season( $d['season_start'], $d['season_end'] );
							$base     = "s[{$term->term_id}]";
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
									<input type="text" name="<?php echo esc_attr( $base ); ?>[season_text]" value="<?php echo esc_attr( $d['season_text'] ); ?>" placeholder="12–16 weeks (summer)" />
									<?php if ( $active ) : ?><span class="aclt-badge"><?php esc_html_e( 'Active now', 'anothercountry-lead-times' ); ?></span><?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>

				<h2><?php esc_html_e( 'Display settings', 'anothercountry-lead-times' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Show on product pages', 'anothercountry-lead-times' ); ?></th>
						<td><label><input type="checkbox" name="settings[auto_display]" value="1" <?php checked( $settings['auto_display'], 1 ); ?> />
							<?php esc_html_e( 'Automatically display the lead-time notice on single product pages.', 'anothercountry-lead-times' ); ?></label>
							<p class="description"><?php echo wp_kses_post( __( 'You can also place it anywhere with the <code>[ac_lead_time]</code> shortcode.', 'anothercountry-lead-times' ) ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="aclt_prefix"><?php esc_html_e( 'Notice label', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_prefix" class="regular-text" name="settings[prefix]" value="<?php echo esc_attr( $settings['prefix'] ); ?>" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="aclt_fallback"><?php esc_html_e( 'Fallback (no supplier)', 'anothercountry-lead-times' ); ?></label></th>
						<td><input type="text" id="aclt_fallback" class="regular-text" name="settings[fallback]" value="<?php echo esc_attr( $settings['fallback'] ); ?>" placeholder="<?php esc_attr_e( '(leave blank to show nothing)', 'anothercountry-lead-times' ); ?>" />
							<p class="description"><?php esc_html_e( 'Shown on products that have no supplier assigned.', 'anothercountry-lead-times' ); ?></p>
						</td>
					</tr>
				</table>

				<?php submit_button( __( 'Save lead times', 'anothercountry-lead-times' ) ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Persist the whole screen on submit.
	 */
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
			update_term_meta( $term_id, 'aclt_season_text', sanitize_text_field( $row['season_text'] ?? '' ) );
		}

		$in = isset( $_POST['settings'] ) && is_array( $_POST['settings'] ) ? wp_unslash( $_POST['settings'] ) : [];
		update_option( 'aclt_settings', [
			'auto_display' => empty( $in['auto_display'] ) ? 0 : 1,
			'prefix'       => sanitize_text_field( $in['prefix'] ?? '' ),
			'fallback'     => sanitize_text_field( $in['fallback'] ?? '' ),
		] );

		wp_safe_redirect( add_query_arg( [ 'page' => self::PAGE, 'updated' => 1 ], admin_url( 'admin.php' ) ) );
		exit;
	}
}
